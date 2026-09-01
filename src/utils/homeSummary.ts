/**
 * 이벤트 목록에서 홈 화면 "오늘의 상태" 카드에 쓸 요약을 계산한다.
 * Phase 1 규칙은 단순하다. Phase 4~5 에서 정교해진다.
 */

import type { CareEvent } from '../types/events';
import { presentEvent } from './eventPresenter';
import { formatClock } from './time';

export interface HomeSummary {
  lastActivityText?: string;
  lastActivityDetail?: string;
  presenceText: string;
  isHome: boolean;
  medicationTakenCount: number;
  medicationPlanned: number;
  medicationText: string;
  watchText: string;
  watchConnected: boolean;
  sosText: string;
  hasSos: boolean;
}

const MEDICATION_PLANNED_PER_DAY = 2;

export function buildHomeSummary(
  events: CareEvent[],
  lastActivity: CareEvent | undefined,
): HomeSummary {
  // events 는 최신 우선 정렬 상태로 들어온다고 가정한다.
  const presenceEvent = events.find(
    (e) => e.eventType === 'left_home' || e.eventType === 'returned_home',
  );
  const isHome = presenceEvent?.eventType !== 'left_home';

  const medicationTakenCount = events.filter(
    (e) => e.eventType === 'medication_taken',
  ).length;

  const lastWatch = events.find((e) => e.source === 'watch');
  const lastSos = events.find((e) => e.eventType === 'sos_triggered');

  return {
    lastActivityText: lastActivity
      ? presentEvent(lastActivity).message
      : undefined,
    lastActivityDetail: lastActivity
      ? `${formatClock(lastActivity.occurredAt)}${
          lastActivity.location ? ` · ${lastActivity.location}` : ''
        }`
      : undefined,
    presenceText: isHome ? '집에 있어요' : '외출 중이에요',
    isHome,
    medicationTakenCount,
    medicationPlanned: MEDICATION_PLANNED_PER_DAY,
    medicationText:
      medicationTakenCount > 0
        ? `오늘 ${MEDICATION_PLANNED_PER_DAY}회 중 ${Math.min(
            medicationTakenCount,
            MEDICATION_PLANNED_PER_DAY,
          )}회 완료`
        : '오늘 복약 기록 없음',
    watchText: lastWatch
      ? `연결됨 · ${formatClock(lastWatch.occurredAt)}`
      : '최근 연결 기록 없음',
    watchConnected: Boolean(lastWatch),
    sosText: lastSos
      ? `${formatClock(lastSos.occurredAt)}에 요청이 있었어요`
      : '긴급 요청 없음',
    hasSos: Boolean(lastSos),
  };
}
