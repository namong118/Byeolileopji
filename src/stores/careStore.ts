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
 *
 * Phase 5 STEP 5.2 — `init()` 이 guardianLinks 로 해석된 careRecipientId 를 인자로
 * 받는다 (app/_layout.tsx 가 로그인+관계 해석 완료 후 호출한다). `teardown()` 은
 * 구독뿐 아니라 데이터소스(eventService)와 파생 상태까지 전부 정리한다 — 로그아웃 후
 * 다른 계정으로 재로그인해도 이전 사용자의 데이터가 남지 않게 하기 위해서다.
 *
 * Phase 5 STEP 5.3-C — Developer Simulation 은 이 스토어를 거치지 않는다
 * (src/services/simulationEventService.ts, 항상 InMemory). 그래서 이 파일에는
 * simulateEvent/actionError 가 없다 — production 데이터소스와 완전히 분리하기 위해서다.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import { create } from 'zustand';

import type { CareEvent } from '../types/events';
import type {
  CareStatus,
  CareStatusResult,
  DeviceHealth,
  DeviceHealthResult,
} from '../types/status';
import type { DeviceDoc } from '../types/device';
import {
  deriveEventViews,
  getDeviceRepo,
  getEventDataSource,
  getEventService,
  initCareDataSource,
  resetCareDataSource,
  type EventDataSource,
} from '../services/eventService';
import type { Unsubscribe } from '../services/eventRepository';
import { deriveCareStatus, applyStatusOverride } from '../services/careStatus';
import { deriveDeviceHealth } from '../services/deviceHealth';
import { careStatusConfig } from '../config/careStatusConfig';
import { DEV_DEVICE_ID } from '../config/careContext';
import {
  presentHome,
  presentStaleHome,
  type CareStatusText,
} from '../utils/careStatusText';
import { buildSeedEvents } from '../mock/seedEvents';
import {
  applySnapshotSync,
  applyStreamFailure,
  initialStreamSync,
  isStreamStale,
  STALE_DATA_MESSAGE,
  type StreamSync,
} from '../services/syncState';
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
  /**
   * 화면이 최신이 아닐 때의 사용자 문구 (STALE_DATA_MESSAGE). 없으면 최신.
   * 구독 오류(failed)와 오프라인 지속(offline, 유예 OFFLINE_STALE_AFTER_MS 초과)을 같은 문구로 보인다.
   * now 로 계산되므로 재계산 타이머마다 갱신되고, 서버 스냅샷이 다시 오면 자동으로 사라진다.
   */
  syncNotice?: string;
}

interface ProjectInput {
  events: CareEvent[];
  deviceDoc?: DeviceDoc;
  now: Date;
  statusOverride?: StatusOverride;
  emergencyAckedAt?: number;
  /** [개발용] 기기 축 자동 판정을 덮어쓴다 */
  deviceHealthOverride?: DeviceHealth;
  /** events 구독 동기화 상태. 없으면 최신으로 본다 (InMemory). */
  eventsSync?: StreamSync;
}

interface CareState extends DerivedSlice {
  ready: boolean;
  loading: boolean;
  loadError?: string;
  dataSource: EventDataSource;
  realtime: boolean;
  careTarget: CareTarget;
  emergencyAckedAt?: number;
  /**
   * 오늘 이벤트가 조회 안전 상한(TODAY_EVENTS_SAFETY_CAP)을 넘어 일부만 담겼는가.
   * true 면 오늘 활동 수는 하한값("N회 이상"), 첫 활동 시각은 알 수 없다.
   */
  todayTruncated: boolean;
  /**
   * events 구독 동기화 상태 (syncState.ts). failed = 구독 오류(재구독 필요),
   * fromCache 지속 = 오프라인(SDK 자동 복구 대기). 둘 다 syncNotice / Hero stale 로 드러난다.
   */
  eventsSync?: StreamSync;

  /** 원격 devices/{id} 문서 (Firestore 모드). 없으면 undefined. */
  deviceDoc?: DeviceDoc;
  /** [개발용] 기기 축 임시 오버라이드 */
  deviceHealthOverride?: DeviceHealth;

  /** guardianLinks 로 해석된 careRecipientId 로 데이터소스를 초기화하고 구독을 시작한다. */
  init: (careRecipientId: string) => Promise<void>;
  reload: () => Promise<void>;
  /** I/O 없이 메모리상 데이터로 상태만 재계산 (타이머 / AppState active) */
  refreshDerived: () => void;
  /** [개발용] 사람 상태를 임시로 덮어쓴다 (TTL 후 자동 판정 복귀) */
  setStatus: (status: CareStatus) => void;
  /** [개발용] 사람 상태 임시 오버라이드 즉시 해제 */
  clearStatusOverride: () => void;
  /** [개발용] EMERGENCY 확인 처리 */
  acknowledgeEmergency: () => void;
  /** [개발용] 기기 축을 임시로 덮어쓴다. undefined 면 자동 판정 복귀. */
  setDeviceHealthOverride: (health: DeviceHealth | undefined) => void;
  /** 구독 + 데이터소스 + 파생 상태를 전부 정리한다 (로그아웃 시 app/_layout.tsx 가 호출). */
  teardown: () => void;
}

// 스토어 밖에서 1개만 유지 (중복 방지)
let realtimeUnsub: Unsubscribe | undefined;
let deviceUnsub: Unsubscribe | undefined;
let recomputeTimer: ReturnType<typeof setInterval> | undefined;
let appStateSub: NativeEventSubscription | undefined;
/** 현재 init() 된 careRecipientId. teardown() 이 undefined 로 되돌린다 (재로그인 시 재초기화 보장). */
let activeCareRecipientId: string | undefined;

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

  // ── 최신성 (구독 오류 / 오프라인 지속) ───────────────────────────────
  const stale = input.eventsSync ? isStreamStale(input.eventsSync, now) : false;

  return {
    syncNotice: stale ? STALE_DATA_MESSAGE : undefined,
    events: views.events,
    todayEvents: views.todayEvents,
    lastActivity: views.lastActivity,
    lastSos: views.lastSos,
    careStatus: derived,
    deviceHealth,
    status: effectivePerson.status,
    statusText: stale
      ? presentStaleHome(
          presentHome(effectivePerson, effectiveDeviceHealth, now),
          effectivePerson,
          input.eventsSync?.lastServerSyncAt,
        )
      : presentHome(effectivePerson, effectiveDeviceHealth, now),
    statusOverride: overrideActive ? input.statusOverride : undefined,
  };
}

async function loadEvents(): Promise<{
  events: CareEvent[];
  todayTruncated: boolean;
  fromCache: boolean;
}> {
  const { events, meta } = await getEventService().getEventsWithMeta();
  return { events, todayTruncated: meta.todayTruncated, fromCache: meta.fromCache === true };
}

/** get() 에서 project 에 넘길 공통 입력을 뽑아낸다 */
function projectInputFrom(
  state: Pick<
    CareState,
    | 'events'
    | 'deviceDoc'
    | 'statusOverride'
    | 'emergencyAckedAt'
    | 'deviceHealthOverride'
    | 'eventsSync'
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
    eventsSync: state.eventsSync,
  };
}

type StoreSet = (partial: Partial<CareState>) => void;

/** getDocs(init / reload) 결과로 eventsSync 갱신 — 캐시 응답이면 서버 확인 시각을 올리지 않는다. */
function syncAfterLoad(prev: StreamSync | undefined, fromCache: boolean, now: Date): StreamSync {
  return applySnapshotSync(prev ?? initialStreamSync(now), { fromCache }, now);
}

/**
 * events 실시간 구독을 (다시) 연다.
 *  - 스냅샷마다 fromCache 로 eventsSync 를 갱신한다 (오프라인 → 서버 복귀 시 자동으로 최신 표시).
 *  - 구독 오류 시 eventsSync.failed — 자동 복구 없음. reload / AppState active 가 다시 연다.
 *    failed 는 다시 연 구독의 첫 스냅샷이 올 때까지 유지된다.
 */
function startEventsRealtime(set: StoreSet, get: () => CareState): void {
  realtimeUnsub?.();
  realtimeUnsub = undefined;
  if (!getEventService().supportsRealtime()) return;

  realtimeUnsub = getEventService().subscribeToEvents(
    (events, meta) => {
      const now = new Date();
      const eventsSync = applySnapshotSync(
        get().eventsSync ?? initialStreamSync(now),
        { fromCache: meta?.fromCache === true },
        now,
      );
      set({
        ...project(projectInputFrom({ ...get(), events, eventsSync }, now)),
        todayTruncated: meta?.todayTruncated ?? false,
        eventsSync,
        realtime: true,
        ready: true,
        loading: false,
      });
    },
    () => {
      // 이 구독은 더 이상 갱신되지 않는다 — 마지막 상태로 조용히 멈추지 않게 표시한다.
      realtimeUnsub?.();
      realtimeUnsub = undefined;
      const now = new Date();
      const eventsSync = applyStreamFailure(get().eventsSync ?? initialStreamSync(now));
      set({
        ...project(projectInputFrom({ ...get(), eventsSync }, now)),
        eventsSync,
        realtime: false,
      });
    },
  );
  set({ realtime: Boolean(realtimeUnsub) });
}

export const useCareStore = create<CareState>((set, get) => ({
  ready: false,
  loading: false,
  loadError: undefined,
  dataSource: 'memory',
  realtime: false,
  careTarget: mockCareTarget,
  emergencyAckedAt: undefined,
  todayTruncated: false,
  deviceDoc: undefined,
  deviceHealthOverride: undefined,

  ...project({ events: [], now: new Date() }),

  init: async (careRecipientId) => {
    if (activeCareRecipientId === careRecipientId) return; // 이미 이 대상으로 초기화됨
    activeCareRecipientId = careRecipientId;
    initCareDataSource(careRecipientId, DEV_DEVICE_ID);

    set({ loading: true, loadError: undefined, dataSource: getEventDataSource() });
    try {
      if (getEventDataSource() === 'memory') {
        await getEventService().seed(buildSeedEvents());
      }
      const { events, todayTruncated, fromCache } = await loadEvents();
      const now = new Date();
      const eventsSync = syncAfterLoad(get().eventsSync, fromCache, now);
      set({
        ...project(projectInputFrom({ ...get(), events, eventsSync }, now)),
        todayTruncated,
        eventsSync,
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
    if (!realtimeUnsub) startEventsRealtime(set, get);

    // devices/{id} 문서 구독 (Firestore 모드, 최초 1회)
    const deviceRepo = getDeviceRepo();
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
        if (next !== 'active') return;
        // 백그라운드 복귀 직후: 날짜가 바뀌었으면 "오늘" 창을 즉시 옮기고(60초 타이머를
        // 기다리지 않는다), 실시간 구독이 끊겨 있으면 다시 연다.
        getEventService().refreshDayWindow();
        if (get().eventsSync?.failed) startEventsRealtime(set, get);
        get().refreshDerived();
      });
    }
  },

  reload: async () => {
    set({ loading: true, loadError: undefined });
    try {
      const { events, todayTruncated, fromCache } = await loadEvents();
      const now = new Date();
      const wasFailed = Boolean(get().eventsSync?.failed);
      // 서버 응답이면 최신으로 돌아오고(failed 해제), 캐시 응답이면 오프라인 상태가 유지된다.
      const eventsSync = syncAfterLoad(get().eventsSync, fromCache, now);
      set({
        ...project(projectInputFrom({ ...get(), events, eventsSync }, now)),
        todayTruncated,
        eventsSync,
        loading: false,
      });
      // 끊긴 실시간 구독은 새로 연다 (다시 실패하면 failed 가 다시 선다).
      if (wasFailed) startEventsRealtime(set, get);
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
    activeCareRecipientId = undefined;
    resetCareDataSource();

    // 이전 사용자의 파생 상태를 전부 비운다 — 다른 계정으로 재로그인해도
    // 새 init() 이 끝나기 전까지 이전 데이터가 화면에 남지 않게 한다.
    set({
      ...project({ events: [], now: new Date() }),
      ready: false,
      loading: false,
      loadError: undefined,
      realtime: false,
      dataSource: 'memory',
      deviceDoc: undefined,
      deviceHealthOverride: undefined,
      emergencyAckedAt: undefined,
      todayTruncated: false,
      eventsSync: undefined,
    });
  },
}));
