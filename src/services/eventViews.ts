/**
 * 이벤트 목록 하나에서 화면이 쓰는 파생 뷰를 계산하는 순수 로직.
 *
 * 최초 로딩 · 수동 새로고침 · Firestore 실시간 스냅샷이 모두 이 함수를 통과한다.
 * (I/O 가 없어 단독 테스트가 쉽다 — firebase 런타임 import 없음)
 */

import type { CareEvent } from '../types/events';

/** 로컬 타임존 기준 같은 날인지. (utils/time 의 isSameDay 와 동일 규칙 — 순수 유지를 위해 인라인) */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "마지막 활동"으로 간주할 이벤트 종류 */
export const ACTIVITY_EVENT_TYPES: ReadonlySet<CareEvent['eventType']> =
  new Set([
    'motion_detected',
    'door_opened',
    'returned_home',
    'left_home',
    'watch_activity',
    'medication_taken',
  ]);

export interface EventViews {
  /** 전체 이벤트 (최신 우선) */
  events: CareEvent[];
  /** 오늘(로컬) 발생한 이벤트 (최신 우선) */
  todayEvents: CareEvent[];
  /** 홈 "마지막 활동" 카드용 */
  lastActivity?: CareEvent;
}

export function deriveEventViews(
  events: CareEvent[],
  now: Date = new Date(),
): EventViews {
  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  return {
    events: sorted,
    todayEvents: sorted.filter((e) =>
      isSameLocalDay(new Date(e.occurredAt), now),
    ),
    lastActivity: sorted.find((e) => ACTIVITY_EVENT_TYPES.has(e.eventType)),
  };
}
