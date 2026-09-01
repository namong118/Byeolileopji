/**
 * UI 가 구독하는 반응형 상태.
 *
 * 상태 변경은 반드시 EventService 를 거쳐 이뤄지고,
 * 그 결과를 여기에 캐시해 화면이 즉시 갱신되도록 한다.
 */

import { create } from 'zustand';

import type { CareEvent, NewCareEvent } from '../types/events';
import type { CareStatus } from '../types/status';
import { eventService } from '../services/eventService';
import { buildSeedEvents } from '../mock/seedEvents';
import { mockCareTarget, type CareTarget } from '../mock/careTarget';

interface CareState {
  ready: boolean;
  careTarget: CareTarget;
  status: CareStatus;

  /** 전체 이벤트 (최신 우선) */
  events: CareEvent[];
  /** 오늘 발생한 이벤트 (최신 우선) */
  todayEvents: CareEvent[];
  /** 홈 "마지막 활동" 카드용 */
  lastActivity?: CareEvent;

  /** 앱 시작 시 목업 데이터 주입 */
  init: () => Promise<void>;
  /** 개발자 시뮬레이션에서 새 이벤트 발생 */
  simulateEvent: (input: NewCareEvent) => Promise<CareEvent>;
  /** 개발자 시뮬레이션에서 상태 강제 변경 */
  setStatus: (status: CareStatus) => void;
}

async function refresh(): Promise<
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
  careTarget: mockCareTarget,
  status: 'NORMAL',
  events: [],
  todayEvents: [],
  lastActivity: undefined,

  init: async () => {
    await eventService.seed(buildSeedEvents());
    set({ ...(await refresh()), ready: true });
  },

  simulateEvent: async (input) => {
    const created = await eventService.recordEvent(input);
    set(await refresh());
    return created;
  },

  setStatus: (status) => set({ status }),
}));
