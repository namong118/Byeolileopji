/**
 * CareStatusResult -> 화면에 보여줄 톤 / 이모지 / 문구.
 *
 * 규칙 엔진(careStatus.ts)은 문자열을 만들지 않는다. 문구는 전부 여기서.
 * UI 에 기술 용어를 노출하지 않는다. (eventPresenter.ts 와 같은 철학)
 *
 * ⚠️ no_data / sensor_offline 에서는 "오늘도 별일 없어요" 처럼
 *    활동이 정상 확인됐다는 의미의 문구를 절대 쓰지 않는다.
 *
 * firebase / time.ts 런타임 import 없음 → 단독 실행 테스트 가능.
 * (날짜 포맷은 time.ts 와 같은 규칙을 순수 유지를 위해 인라인)
 */

import type { CareStatusResult } from '../types/status';

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

    case 'sensor_offline':
      // Phase 4.1+ 에서 실제로 나온다. 확정 문구 금지.
      return {
        tone: 'neutral',
        emoji: '⚪',
        headline: '연결 상태를 확인하고 있어요',
        detail: '센서 연결이 확인되면 활동 정보를 다시 보여드릴게요.',
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
