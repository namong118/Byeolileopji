/**
 * UI 가 구독하는 반응형 상태.
 *
 * 상태 변경은 반드시 EventService 를 거쳐 이뤄지고,
 * 그 결과를 여기에 캐시해 화면이 즉시 갱신되도록 한다.
 *
 *   UI → careStore → EventService → EventRepository → (Firestore | InMemory)
 *
 * Firestore 모드에서는 앱 시작 시 실시간 구독을 한 번만 시작한다.
 * 외부(예: Phase 3 의 ESP32)에서 events 컬렉션에 문서가 추가되면
 * onSnapshot → careStore → Home/Timeline 이 자동 갱신된다.
 */

import { create } from 'zustand';

import type { CareEvent, NewCareEvent } from '../types/events';
import type { CareStatus } from '../types/status';
import {
  deriveEventViews,
  EVENT_DATA_SOURCE,
  eventService,
  type EventDataSource,
  type EventViews,
} from '../services/eventService';
import type { Unsubscribe } from '../services/eventRepository';
import { buildSeedEvents } from '../mock/seedEvents';
import { mockCareTarget, type CareTarget } from '../mock/careTarget';

interface CareState {
  /** 최초 로딩이 끝났는지 */
  ready: boolean;
  /** 기록을 불러오는 중인지 */
  loading: boolean;
  /** 로딩 실패 시 사용자용 메시지 */
  loadError?: string;
  /** 마지막 이벤트 저장 실패 시 사용자용 메시지 */
  actionError?: string;
  /** 현재 데이터 출처 (개발자 화면 표시용) */
  dataSource: EventDataSource;
  /** 실시간 구독이 활성 상태인지 */
  realtime: boolean;

  careTarget: CareTarget;
  status: CareStatus;

  events: CareEvent[];
  todayEvents: CareEvent[];
  lastActivity?: CareEvent;

  /** 앱 시작 시: 최초 로딩 + (지원 시) 실시간 구독 시작 */
  init: () => Promise<void>;
  /** 저장소에서 다시 읽어와 화면 갱신 (수동 새로고침) */
  reload: () => Promise<void>;
  /** 개발자 시뮬레이션에서 새 이벤트 발생 → 저장 → 갱신 */
  simulateEvent: (input: NewCareEvent) => Promise<CareEvent>;
  /** 개발자 시뮬레이션에서 상태 강제 변경 */
  setStatus: (status: CareStatus) => void;
  /** 실시간 구독 해제 (앱 종료/언마운트 시) */
  teardown: () => void;
}

/** 실시간 구독 해제 함수 — 스토어 밖에서 1개만 유지 (중복 구독 방지) */
let realtimeUnsub: Unsubscribe | undefined;

async function loadViews(): Promise<EventViews> {
  const events = await eventService.getEvents();
  return deriveEventViews(events);
}

export const useCareStore = create<CareState>((set, get) => ({
  ready: false,
  loading: false,
  loadError: undefined,
  actionError: undefined,
  dataSource: EVENT_DATA_SOURCE,
  realtime: false,

  careTarget: mockCareTarget,
  status: 'NORMAL',
  events: [],
  todayEvents: [],
  lastActivity: undefined,

  init: async () => {
    set({ loading: true, loadError: undefined });
    try {
      // Firestore 모드는 서버 데이터를 그대로 쓴다. 목업 seed 는 InMemory 에서만.
      if (EVENT_DATA_SOURCE === 'memory') {
        await eventService.seed(buildSeedEvents());
      }
      set({ ...(await loadViews()), ready: true, loading: false });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] init 실패', error);
      set({
        ready: true,
        loading: false,
        loadError:
          '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }

    // 실시간 구독은 최초 1회만 시작한다.
    if (!realtimeUnsub && eventService.supportsRealtime()) {
      realtimeUnsub = eventService.subscribeToEvents((events) => {
        set({ ...deriveEventViews(events), ready: true, loading: false });
      });
      set({ realtime: Boolean(realtimeUnsub) });
    }
  },

  reload: async () => {
    set({ loading: true, loadError: undefined });
    try {
      set({ ...(await loadViews()), loading: false });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] reload 실패', error);
      set({
        loading: false,
        loadError:
          '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }
  },

  simulateEvent: async (input) => {
    set({ actionError: undefined });
    try {
      const created = await eventService.recordEvent(input);
      // 저장 성공 후에만 화면을 갱신한다. (낙관적 업데이트로 착시 주지 않기)
      // 실시간 구독이 켜져 있으면 onSnapshot 이 곧 갱신하므로 재조회는 생략.
      if (!get().realtime) {
        set(await loadViews());
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

  setStatus: (status) => set({ status }),

  teardown: () => {
    realtimeUnsub?.();
    realtimeUnsub = undefined;
    set({ realtime: false });
  },
}));
