/**
 * UI 가 구독하는 반응형 상태.
 *
 * 상태 변경은 반드시 EventService 를 거쳐 이뤄지고,
 * 그 결과를 여기에 캐시해 화면이 즉시 갱신되도록 한다.
 *
 *   UI → careStore → EventService → EventRepository → (Supabase | InMemory)
 */

import { create } from 'zustand';

import type { CareEvent, NewCareEvent } from '../types/events';
import type { CareStatus } from '../types/status';
import {
  EVENT_DATA_SOURCE,
  eventService,
  type EventDataSource,
} from '../services/eventService';
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

  careTarget: CareTarget;
  status: CareStatus;

  /** 전체 이벤트 (최신 우선) */
  events: CareEvent[];
  /** 오늘 발생한 이벤트 (최신 우선) */
  todayEvents: CareEvent[];
  /** 홈 "마지막 활동" 카드용 */
  lastActivity?: CareEvent;

  /** 앱 시작 시 저장소에서 이벤트 로딩 */
  init: () => Promise<void>;
  /** 저장소에서 다시 읽어와 화면 갱신 */
  reload: () => Promise<void>;
  /** 개발자 시뮬레이션에서 새 이벤트 발생 → 저장 → 갱신 */
  simulateEvent: (input: NewCareEvent) => Promise<CareEvent>;
  /** 개발자 시뮬레이션에서 상태 강제 변경 */
  setStatus: (status: CareStatus) => void;
}

async function readAll(): Promise<
  Pick<CareState, 'events' | 'todayEvents' | 'lastActivity'>
> {
  const [events, todayEvents, lastActivity] = await Promise.all([
    eventService.getEvents(),
    eventService.getTodayEvents(),
    eventService.getLastActivity(),
  ]);
  return { events, todayEvents, lastActivity };
}

export const useCareStore = create<CareState>((set) => ({
  ready: false,
  loading: false,
  loadError: undefined,
  actionError: undefined,
  dataSource: EVENT_DATA_SOURCE,

  careTarget: mockCareTarget,
  status: 'NORMAL',
  events: [],
  todayEvents: [],
  lastActivity: undefined,

  init: async () => {
    set({ loading: true, loadError: undefined });
    try {
      // Supabase 모드에서는 서버 데이터를 그대로 쓴다. 목업 seed 는 InMemory 에서만.
      if (EVENT_DATA_SOURCE === 'memory') {
        await eventService.seed(buildSeedEvents());
      }
      set({ ...(await readAll()), ready: true, loading: false });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] init 실패', error);
      set({
        ready: true,
        loading: false,
        loadError: '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }
  },

  reload: async () => {
    set({ loading: true, loadError: undefined });
    try {
      set({ ...(await readAll()), loading: false });
    } catch (error) {
      if (__DEV__) console.error('[별일없지] reload 실패', error);
      set({
        loading: false,
        loadError: '기록을 불러오지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.',
      });
    }
  },

  simulateEvent: async (input) => {
    set({ actionError: undefined });
    try {
      const created = await eventService.recordEvent(input);
      // 저장 성공 후에만 화면을 갱신한다. (낙관적 업데이트로 착시 주지 않기)
      set(await readAll());
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
}));
