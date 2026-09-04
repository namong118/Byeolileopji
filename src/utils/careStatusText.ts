/**
 * CareStatusResult / DeviceHealth -> 화면에 보여줄 톤 / 이모지 / 문구.
 *
 * 규칙 엔진(careStatus.ts / deviceHealth.ts)은 문자열을 만들지 않는다. 문구는 전부 여기서.
 * UI 에 기술 용어를 노출하지 않는다. (eventPresenter.ts 와 같은 철학)
 *
 * 표시 경계 규칙 (presentHome):
 *  - EMERGENCY 는 기기 상태와 무관하게 최우선.
 *  - deviceHealth === 'offline' 이면 (EMERGENCY 아닌 한) 절대 "오늘도 별일 없어요"
 *    초록 Hero 를 쓰지 않는다. 중립 문구를 쓴다.
 *  - deviceHealth === 'unknown' 은 장애가 아니다. 기존 4.0 Hero 를 그대로 쓴다.
 *  - ⚠️ Phase 4.1a 실제 데이터에서는 heartbeat 가 없어 offline 이 나오지 않는다.
 *
 * firebase / time.ts 런타임 import 없음 → 단독 실행 테스트 가능.
 * (날짜 포맷은 time.ts 와 같은 규칙을 순수 유지를 위해 인라인)
 */

import type { CareStatusResult, DeviceHealth } from '../types/status';

export type StatusTone = 'normal' | 'check' | 'emergency' | 'neutral';

export interface CareStatusText {
  tone: StatusTone;
  emoji: string;
  headline: string;
  detail: string;
}

// ── 인라인 포맷터 (time.ts 와 동일 규칙) ─────────────────────────────────

function clock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const isAm = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${isAm ? '오전' : '오후'} ${h12}:${m}`;
}

function relative(iso: string, now: Date): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

function sinceDuration(minutes: number | undefined): string {
  if (minutes == null) return '한동안';
  if (minutes < 60) return `약 ${minutes}분째`;
  return `약 ${Math.floor(minutes / 60)}시간째`;
}

// ── 상태별 문구 ────────────────────────────────────────────────────────

const OVERRIDE_HEADLINE: Record<CareStatusResult['status'], string> = {
  NORMAL: '오늘도 별일 없어요',
  CHECK: '한번 확인해 주세요',
  EMERGENCY: '도움이 필요할 수 있어요',
};

export function presentCareStatus(
  result: CareStatusResult,
  now: Date = new Date(),
): CareStatusText {
  switch (result.reason) {
    case 'sos':
      return {
        tone: 'emergency',
        emoji: '🔴',
        headline: '도움이 필요할 수 있어요',
        detail: result.emergencyEventAt
          ? `${clock(result.emergencyEventAt)}에 도움 요청이 있었어요.`
          : '도움 요청이 있었어요.',
      };

    case 'inactivity':
      return {
        tone: 'check',
        emoji: '🟡',
        headline: '한번 확인해 주세요',
        detail: `${sinceDuration(
          result.minutesSinceActivity,
        )} 활동이 확인되지 않았어요.`,
      };

    case 'recent_activity':
      return {
        tone: 'normal',
        emoji: '🟢',
        headline: '오늘도 별일 없어요',
        detail: result.lastActivityAt
          ? `${relative(result.lastActivityAt, now)}에 활동이 확인됐어요.`
          : '최근 활동이 확인됐어요.',
      };

    case 'manual_override':
      return {
        tone:
          result.status === 'EMERGENCY'
            ? 'emergency'
            : result.status === 'CHECK'
              ? 'check'
              : 'normal',
        emoji:
          result.status === 'EMERGENCY'
            ? '🔴'
            : result.status === 'CHECK'
              ? '🟡'
              : '🟢',
        headline: OVERRIDE_HEADLINE[result.status],
        detail: '개발자 모드에서 지정한 상태예요.',
      };

    case 'no_data':
    default:
      // ⚠️ 확정 표현("오늘도 별일 없어요") 금지 — 중립 문구
      return {
        tone: 'neutral',
        emoji: '⚪',
        headline: '아직 활동 정보가 없어요',
        detail: '활동 기록이 들어오면 여기에서 확인할 수 있어요.',
      };
  }
}

/**
 * 사람 축 + 기기 축을 **표시 경계에서만** 조합해 Hero 문구 1개를 만든다.
 * (두 enum 을 합치지 않는다 — 여기서 copy 만 고른다)
 *
 * @param careStatus 오버라이드가 이미 적용된(effective) 사람-축 결과
 * @param deviceHealth 오버라이드가 이미 적용된(effective) 기기-축 상태
 */
export function presentHome(
  careStatus: CareStatusResult,
  deviceHealth: DeviceHealth,
  now: Date = new Date(),
): CareStatusText {
  // 1) EMERGENCY 는 기기 상태와 무관하게 최우선
  if (careStatus.status === 'EMERGENCY') {
    return presentCareStatus(careStatus, now);
  }

  // 2) 기기 offline → 절대 "오늘도 별일 없어요" 초록 Hero 금지, 중립 문구
  //    (Phase 4.1a 실제 데이터에서는 heartbeat 가 없어 여기 도달하지 않는다)
  if (deviceHealth === 'offline') {
    return {
      tone: 'neutral',
      emoji: '⚪',
      headline: '센서 연결을 확인하고 있어요',
      detail: careStatus.lastActivityAt
        ? `마지막 활동은 ${relative(careStatus.lastActivityAt, now)}에 있었어요.`
        : '센서 연결이 확인되면 활동 정보를 다시 보여드릴게요.',
    };
  }

  // 3) online / unknown → 기존 4.0 문구 그대로
  //    (unknown 자체는 장애가 아니다 — 우리가 받은 이벤트를 무효화하지 않는다)
  return presentCareStatus(careStatus, now);
}
