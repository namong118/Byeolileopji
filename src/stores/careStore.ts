/**
 * UI 가 구독하는 반응형 상태.
 *
 *   UI → careStore → EventService → EventRepository → (Firestore | InMemory)
 *
 * Firestore 모드에서는 앱 시작 시 실시간 구독을 한 번만 시작한다.
 * 외부(ESP32)에서 events 컬렉션에 문서가 추가되면 onSnapshot → careStore → 화면이 갱신된다.
 *
 * Phase 4.0 — 상태 자동 판정:
 *  - deriveEventViews(이벤트 스캔) + deriveCareStatus(판정 규칙)를 합성한다.
 *  - init / reload / onSnapshot / 저빈도 타이머 / AppState active 가 모두 같은
 *    project() 를 통과한다.
 *  - 저빈도 타이머는 메모리상 events 로만 재계산한다. Firestore read/write 없음.
 *  - 개발자 화면의 상태 버튼은 "임시 오버라이드"(TTL 有) 이며 만료되면 자동 판정으로 복귀한다.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import type { CareEvent, NewCareEvent } from '../types/events';
import type { CareStatus, CareStatusResult } from '../types/status';
import {
  deriveEventViews,
  EVENT_DATA_SOURCE,
  eventService,
  type EventDataSource,
} from '../services/eventService';
import type { Unsubscribe } from '../services/eventRepository';
import {
  deriveCareStatus,
  applyStatusOverride,
} from '../services/careStatus';
import { careStatusConfig } from '../config/careStatusConfig';
import {
  presentCareStatus,
  type CareStatusText,
} from '../utils/careStatusText';
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
  /** 순수 판정 결과 (오버라이드 미적용) — 개발자 화면 "derived status" */
  careStatus: CareStatusResult;
  /** 화면에 실제로 보이는 상태 (오버라이드 적용) — 기존 코드 호환 필드명 */
  status: CareStatus;
  /** 홈 hero 표시용 톤/이모지/문구 (effective 기준) */
  statusText: CareStatusText;
  /** 오버라이드가 유효하면 그 값, 아니면 undefined (만료 시 자동 제거) */
  statusOverride?: StatusOverride;
}

interface CareState extends DerivedSlice {
  ready: boolean;
  loading: boolean;
  loadError?: string;
  actionError?: string;
  dataSource: EventDataSource;
  realtime: boolean;
  careTarget: CareTarget;
  /** 긴급 확인 시각 (epoch ms) — Phase 4.0 클라이언트 전용 */
  emergencyAckedAt?: number;

  /** 앱 시작: 최초 로딩 + 실시간 구독 + 저빈도 재계산 타이머 + AppState 리스너 */
  init: () => Promise<void>;
  /** 저장소에서 다시 읽어와 화면 갱신 (수동 새로고침) */
  reload: () => Promise<void>;
  /** I/O 없이 메모리상 events 로 상태만 재계산 (타이머 / AppState active) */
  refreshDerived: () => void;
  /** 개발자 시뮬레이션에서 새 이벤트 발생 → 저장 → 갱신 */
  simulateEvent: (input: NewCareEvent) => Promise<CareEvent>;
  /** [개발용] 상태를 임시로 덮어쓴다 (TTL 후 자동 판정 복귀) */
  setStatus: (status: CareStatus) => void;
  /** [개발용] 임시 오버라이드 즉시 해제 → 자동 판정으로 복귀 */
  clearStatusOverride: () => void;
  /** [개발용] EMERGENCY 확인 처리 (테스트용) */
  acknowledgeEmergency: () => void;
  /** 실시간 구독 / 타이머 / 리스너 해제 (앱 종료·언마운트 시) */
  teardown: () => void;
}

// 스토어 밖에서 1개만 유지 (중복 방지)
let realtimeUnsub: Unsubscribe | undefined;
let recomputeTimer: ReturnType<typeof setInterval> | undefined;
let appStateSub: NativeEventSubscription | undefined;

/** 이벤트 목록 → 파생 상태 (뷰 + 판정 + 오버라이드 적용). 순수. */
function project(
  events: CareEvent[],
  now: Date,
  override: StatusOverride | undefined,
  emergencyAckedAt: number | undefined,
): DerivedSlice {
  const views = deriveEventViews(events, now);

  const derived = deriveCareStatus({
    lastActivityAt: views.lastActivity?.occurredAt,
    lastSosAt: views.lastSos?.occurredAt,
    totalEventCount: views.events.length,
    config: careStatusConfig,
    now,
    emergencyAckedAt,
  });

  const overrideActive = Boolean(override && override.until > now.getTime());
  const effective = applyStatusOverride(
    derived,
    overrideActive ? override : undefined,
    now,
  );

  return {
    events: views.events,
    todayEvents: views.todayEvents,
    lastActivity: views.lastActivity,
    lastSos: views.lastSos,
    careStatus: derived,
    status: effective.status,
    statusText: presentCareStatus(effective, now),
    statusOverride: overrideActive ? override : undefined,
  };
}

async function loadEvents(): Promise<CareEvent[]> {
  return eventService.getEvents();
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

  ...project([], new Date(), undefined, undefined),

  init: async () => {
    set({ loading: true, loadError: undefined });
    try {
      if (EVENT_DATA_SOURCE === 'memory') {
        await eventService.seed(buildSeedEvents());
      }
      const events = await loadEvents();
      set({
        ...project(events, new Date(), get().statusOverride, get().emergencyAckedAt),
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

    // 실시간 구독 (최초 1회)
    if (!realtimeUnsub && eventService.supportsRealtime()) {
      realtimeUnsub = eventService.subscribeToEvents((events) => {
        set({
          ...project(events, new Date(), get().statusOverride, get().emergencyAckedAt),
          ready: true,
          loading: false,
        });
      });
      set({ realtime: Boolean(realtimeUnsub) });
    }

    // 저빈도 재계산 타이머 (이벤트가 없어도 시간 경과로 NORMAL→CHECK)
    if (!recomputeTimer) {
      recomputeTimer = setInterval(() => {
        get().refreshDerived();
      }, careStatusConfig.recomputeIntervalMs);
    }

    // 포그라운드 복귀 시 즉시 1회 재계산 (백그라운드에서 타이머가 throttle 되므로)
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
        ...project(events, new Date(), get().statusOverride, get().emergencyAckedAt),
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
    const { events, statusOverride, emergencyAckedAt } = get();
    set(project(events, new Date(), statusOverride, emergencyAckedAt));
  },

  simulateEvent: async (input) => {
    set({ actionError: undefined });
    try {
      const created = await eventService.recordEvent(input);
      // 저장 성공 후에만 갱신. 실시간 구독이 켜져 있으면 onSnapshot 이 곧 갱신.
      if (!get().realtime) {
        const events = await loadEvents();
        set(
          project(events, new Date(), get().statusOverride, get().emergencyAckedAt),
        );
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
    const override: StatusOverride = {
      status,
      until: Date.now() + careStatusConfig.overrideTtlMs,
    };
    set(
      project(get().events, new Date(), override, get().emergencyAckedAt),
    );
  },

  clearStatusOverride: () => {
    set(project(get().events, new Date(), undefined, get().emergencyAckedAt));
  },

  acknowledgeEmergency: () => {
    const ackedAt = Date.now();
    set({
      emergencyAckedAt: ackedAt,
      ...project(get().events, new Date(), get().statusOverride, ackedAt),
    });
  },

  teardown: () => {
    realtimeUnsub?.();
    realtimeUnsub = undefined;
    if (recomputeTimer) {
      clearInterval(recomputeTimer);
      recomputeTimer = undefined;
    }
    appStateSub?.remove();
    appStateSub = undefined;
    set({ realtime: false });
  },
}));
