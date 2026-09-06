/**
 * 이벤트 목록에서 홈 화면 상단에 쓸 최소 요약을 계산한다.
 *
 * STEP A: 보호자 홈을 "지금 별일 없나?" 한 가지 질문에 집중시키기 위해
 * 복약 / 스마트워치 / SOS 요약을 홈에서 제거했다. (개발자 탭 시뮬레이션은 유지)
 *
 * STEP B: "마지막 활동"을 보호자가 읽기 쉬운 상대시간 중심 문구로 바꿨다.
 * "외출 / 귀가"는 신뢰성이 아직 부족해 홈에는 표시하지 않지만,
 * 계산 로직과 타입은 뒤 단계에서 재사용하려고 그대로 둔다.
 */

import type { CareEvent } from '../types/events';
import { formatRelativeDetailed } from './time';

export interface HomeSummary {
  /** "3시간 12분 전 · 침실" 형태. 활동 기록이 없으면 undefined. */
  lastActivityText?: string;
  /** "집에 있어요" / "외출 중이에요" (STEP B 홈에는 미표시, 계산/타입은 유지) */
  presenceText: string;
  isHome: boolean;
}

export function buildHomeSummary(
  events: CareEvent[],
  lastActivity: CareEvent | undefined,
  now: Date = new Date(),
): HomeSummary {
  // events 는 최신 우선 정렬 상태로 들어온다고 가정한다.
  const presenceEvent = events.find(
    (e) => e.eventType === 'left_home' || e.eventType === 'returned_home',
  );
  const isHome = presenceEvent?.eventType !== 'left_home';

  return {
    lastActivityText: lastActivity
      ? `${formatRelativeDetailed(lastActivity.occurredAt, now)}${
          lastActivity.location ? ` · ${lastActivity.location}` : ''
        }`
      : undefined,
    presenceText: isHome ? '집에 있어요' : '외출 중이에요',
    isHome,
  };
}
