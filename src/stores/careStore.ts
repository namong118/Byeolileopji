/**
 * UI 가 구독하는 반응형 상태.
 *
 *   UI → careStore → EventService / deviceRepo → Firestore | InMemory
 *
 * Phase 4.0 — 사람 축 자동 판정 (deriveCareStatus).
 * Phase 4.1a/4.1b — 기기 축(DeviceHealth)을 **완전히 독립된 두 번째 축**으로 관리한다.
 *   - deriveCareStatus() (사람)  /  deriveDeviceHealth() (기기)  를 project() 에서 독립 계산
 *   - 두 enum 을 합치지 않는다. 스토어에도 별도 필드 (careStatus / deviceHealth)
 *   - 표시 경계(presentHome)에서만 조합해 Hero 문구 1개를 만든다
 *   - 4.1b: ESP32 heartbeat → devices/{id}.lastHeartbeatAt → deviceHealth online/offline 실제 판정
 *
 * init / reload / onSnapshot(events) / onSnapshot(device) / 저빈도 타이머 / AppState active
 * 가 모두 같은 project() 를 통과한다. 타이머 재계산은 Firestore I/O 없음.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import type { CareEvent, NewCareEvent } from '../types/events';
import type {
  CareStatus,
  CareStatusResult,
  DeviceHealth,
  DeviceHealthResult,
} from '../types/status';
import type { DeviceDoc } from '../types/device';
import {
  deriveEventViews,
  deviceRepo,
  EVENT_DATA_SOURCE,
  eventService,
  type EventDataSource,
} from '../services/eventService';
import type { Unsubscribe } from '../services/eventRepository';
import { deriveCareStatus, applyStatusOverride } from '../services/careStatus';
import { deriveDeviceHealth } from '../services/deviceHealth';
import { careStatusConfig } from '../config/careStatusConfig';
import { presentHome, type CareStatusText } from '../utils/careStatusText';
import { buildSeedEvents } from '../mock/seedEvents';
import { mockCareTarget, type CareTarget } from '../mock/careTarget';

interface StatusOverride {
  status: CareStatus;
  /** epoch ms — 이 시각이 지나면 오버라이드 무효, 자동 판정 복귀 */
  until: number;
}

/** project() 가 계산해 스토어에 반영하는 파생 상태 묶음 */
interface DerivedSlice {
  events: CareEvent[];
  todayEvents: CareEvent[];
  lastActivity?: CareEvent;
  lastSos?: CareEvent;
  /** 사람 축 순수 판정 결과 (오버라이드 미적용) */
  careStatus: CareStatusResult;
  /** 기기 축 순수 판정 결과 (오버라이드 미적용) */
  deviceHealth: DeviceHealthResult;
  /** 화면에 실제로 보이는 사람 상태 (오버라이드 적용) — 기존 코드 호환 필드명 */
  status: CareStatus;
  /** 홈 hero 표시용 톤/이모지/문구 (사람+기기 조합) */
  statusText: CareStatusText;
  /** 사람 상태 오버라이드가 유효하면 그 값 (만료 시 자동 제거) */
  statusOverride?: StatusOverride;
}

interface ProjectInput {
  events: CareEvent[];
  deviceDoc?: DeviceDoc;
  now: Date;
  statusOverride?: StatusOverride;
  emergencyAckedAt?: number;
  /** [개발용] 기기 축 자동 판정을 덮어쓴다 */
  deviceHealthOverride?: DeviceHealth;
}

interface CareState extends DerivedSlice {
  ready: boolean;
  loading: boolean;
  loadError?: string;
  actionError?: string;
  dataSource: EventDataSource;
  realtime: boolean;
  careTarget: CareTarget;
  emergencyAckedAt?: number;

  /** 원격 devices/{id} 문서 (Firestore 모드). 없으면 undefined. */
  deviceDoc?: DeviceDoc;
  /** [개발용] 기기 축 임시 오버라이드 */
  deviceHealthOverride?: DeviceHealth;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  /** I/O 없이 메모리상 데이터로 상태만 재계산 (타이머 / AppState active) */
  refreshDerived: () => void;
  simulateEvent: (input: NewCareEvent) => Promise<CareEvent>;
  /** [개발용] 사람 상태를 임시로 덮어쓴다 (TTL 후 자동 판정 복귀) */
  setStatus: (status: CareStatus) => void;
  /** [개발용] 사람 상태 임시 오버라이드 즉시 해제 */
  clearStatusOverride: () => void;
  /** [개발용] EMERGENCY 확인 처리 */
  acknowledgeEmergency: () => void;
  /** [개발용] 기기 축을 임시로 덮어쓴다. undefined 면 자동 판정 복귀. */
  setDeviceHealthOverride: (health: DeviceHealth | undefined) => void;
  teardown: () => void;
}

// 스토어 밖에서 1개만 유지 (중복 방지)
let realtimeUnsub: Unsubscribe | undefined;
let deviceUnsub: Unsubscribe | undefined;
let recomputeTimer: ReturnType<typeof setInterval> | undefined;
let appStateSub: NativeEventSubscription | undefined;

/** 이벤트 + 기기 문서 → 파생 상태 (두 축 독립 계산 + 표시 조합). 순수. */
function project(input: ProjectInput): DerivedSlice {
  const { events, deviceDoc, now } = input;

  // ── 사람 축 ──────────────────────────────────────────────────────────
  const views = deriveEventViews(events, now);
  const derived = deriveCareStatus({
    lastActivityAt: views.lastActivity?.occurredAt,
    lastSosAt: views.lastSos?.occurredAt,
    totalEventCount: views.events.length,
    config: careStatusConfig,
    now,
    emergencyAckedAt: input.emergencyAckedAt,
  });
  const overrideActive = Boolean(
    input.statusOverride && input.statusOverride.until > now.getTime(),
  );
  const effectivePerson = applyStatusOverride(
    derived,
    overrideActive ? input.statusOverride : undefined,
    now,
  );

  // ── 기기 축 (독립) ───────────────────────────────────────────────────
  const deviceHealth = deriveDeviceHealth({
    deviceDocExists: Boolean(deviceDoc),
    lastEventAt: deviceDoc?.lastEventAt,
    lastHeartbeatAt: deviceDoc?.lastHeartbeatAt, // 4.1b: heartbeat 도입 시 채워짐
    config: careStatusConfig,
    now,
  });
  const effectiveDeviceHealth: DeviceHealth =
    input.deviceHealthOverride ?? deviceHealth.health;

  return {
    events: views.events,
    todayEvents: views.todayEvents,
    lastActivity: views.lastActivity,
    lastSos: views.lastSos,
    careStatus: derived,
    deviceHealth,
    status: effectivePerson.status,
    statusText: presentHome(effectivePerson, effectiveDeviceHealth, now),
    statusOverride: overrideActive ? input.statusOverride : undefined,
  };
}

async function loadEvents(): Promise<CareEvent[]> {
  return eventService.getEvents();
}

/** get() 에서 project 에 넘길 공통 입력을 뽑아낸다 */
function projectInputFrom(
  state: Pick<
    CareState,
    'events' | 'deviceDoc' | 'statusOverride' | 'emergencyAckedAt' | 'deviceHealthOverride'
  >,
  now: Date,
): ProjectInput {
  return {
    events: state.events,
    deviceDoc: state.deviceDoc,
    now,
    statusOverride: state.statusOverride,
    emergencyAckedAt: state.emergencyAckedAt,
    deviceHealthOverride: state.deviceHealthOverride,
  };
}

export const useCareStore = create<CareState>((set, get) => ({
  ready: false,
  loading: false,
  loadError: undefined,
  actionError: undefined,
  dataSource: EVENT_DATA_SOURCE,
  realtime: false,
  careTarget: mockCareTarget,
  emergencyAckedAt: undefined,
  deviceDoc: undefined,
  deviceHealthOverride: undefined,

  ...project({ events: [], now: new Date() }),

  init: async () => {
    set({ loading: true, loadError: undefined });
    try {
      if (EVENT_DATA_SOURCE === 'memory') {
        await eventService.seed(buildSeedEvents());
      }
      const events = await loadEvents();
      set({
        ...project(projectInputFrom({ ...get(), events }, new Date())),
        ready: true,
        loading: false,
      });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] init 실패', error);
      set({
        ready: true,
        loading: false,
        loadError:
          '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }

    // events 실시간 구독 (최초 1회)
    if (!realtimeUnsub && eventService.supportsRealtime()) {
      realtimeUnsub = eventService.subscribeToEvents((events) => {
        set({
          ...project(projectInputFrom({ ...get(), events }, new Date())),
          ready: true,
          loading: false,
        });
      });
      set({ realtime: Boolean(realtimeUnsub) });
    }

    // devices/{id} 문서 구독 (Firestore 모드, 최초 1회)
    if (!deviceUnsub && deviceRepo) {
      deviceUnsub = deviceRepo.subscribe((deviceDoc) => {
        set({
          deviceDoc,
          ...project(projectInputFrom({ ...get(), deviceDoc }, new Date())),
        });
      });
    }

    // 저빈도 재계산 타이머 (이벤트/heartbeat 가 없어도 시간 경과 반영)
    if (!recomputeTimer) {
      recomputeTimer = setInterval(() => {
        get().refreshDerived();
      }, careStatusConfig.recomputeIntervalMs);
    }

    // 포그라운드 복귀 시 즉시 1회 재계산
    if (!appStateSub) {
      appStateSub = AppState.addEventListener('change', (next) => {
        if (next === 'active') get().refreshDerived();
      });
    }
  },

  reload: async () => {
    set({ loading: true, loadError: undefined });
    try {
      const events = await loadEvents();
      set({
        ...project(projectInputFrom({ ...get(), events }, new Date())),
        loading: false,
      });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] reload 실패', error);
      set({
        loading: false,
        loadError:
          '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }
  },

  refreshDerived: () => {
    set(project(projectInputFrom(get(), new Date())));
  },

  simulateEvent: async (input) => {
    set({ actionError: undefined });
    try {
      const created = await eventService.recordEvent(input);
      if (!get().realtime) {
        const events = await loadEvents();
        set(project(projectInputFrom({ ...get(), events }, new Date())));
      }
      return created;
    } catch (error) {
      if (__DEV__) console.error('[별일없지] 이벤트 저장 실패', error);
      set({
        actionError: '이벤트 저장에 실패했어요. 네트워크 연결을 확인해 주세요.',
      });
      throw error;
    }
  },

  setStatus: (status) => {
    const statusOverride: StatusOverride = {
      status,
      until: Date.now() + careStatusConfig.overrideTtlMs,
    };
    set(project(projectInputFrom({ ...get(), statusOverride }, new Date())));
  },

  clearStatusOverride: () => {
    set(
      project(
        projectInputFrom({ ...get(), statusOverride: undefined }, new Date()),
      ),
    );
  },

  acknowledgeEmergency: () => {
    const emergencyAckedAt = Date.now();
    set({
      emergencyAckedAt,
      ...project(projectInputFrom({ ...get(), emergencyAckedAt }, new Date())),
    });
  },

  setDeviceHealthOverride: (health) => {
    set({
      deviceHealthOverride: health,
      ...project(
        projectInputFrom({ ...get(), deviceHealthOverride: health }, new Date()),
      ),
    });
  },

  teardown: () => {
    realtimeUnsub?.();
    realtimeUnsub = undefined;
    deviceUnsub?.();
    deviceUnsub = undefined;
    if (recomputeTimer) {
      clearInterval(recomputeTimer);
      recomputeTimer = undefined;
    }
    appStateSub?.remove();
    appStateSub = undefined;
    set({ realtime: false });
  },
}));
