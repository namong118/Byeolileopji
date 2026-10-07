/**
 * "오늘 활동" 요약 — 홈에서 **정보 표시용**. 상태 판정이 아니다.
 *
 * 오늘(로컬 날짜)에 발생한 "생활 움직임" 이벤트 수와 첫/마지막 시각만 계산한다.
 *
 * ── 왜 별도 분류(DAILY_LIVING_ACTIVITY_EVENT_TYPES)를 쓰는가 ─────────────
 *  eventViews.ts 의 ACTIVITY_EVENT_TYPES 는 "마지막 활동" 판정 / careStatus 판정용으로,
 *  넓은 의미의 "사람이 뭔가 했다" 신호(복약·워치 포함)를 모은 것이다. 그건 그대로 둔다.
 *
 *  반면 홈의 "오늘 활동 N번" 은 보호자가 **생활 움직임 횟수**로 읽는다.
 *  medication_taken / watch_activity 를 "움직임 1회" 로 함께 세면
 *  숫자의 의미가 흐려진다(복약 1회 = 거실 이동 1회?). 그래서 이 카드에서는
 *  물리적 생활 동선(모션 / 문 / 외출 / 귀가)만 센다.
 *
 *  - heartbeat 는 events 컬렉션에 문서를 만들지 않으므로 애초에 집계 대상이 아니다.
 *  - sos_triggered / medication_missed / medication_taken / watch_activity 는 제외된다.
 *  - 0 건이어도 그것만으로 CHECK/EMERGENCY 로 해석하지 않는다 (상태 엔진은 careStatus 담당).
 *
 * 순수 함수. firebase / react import 없음. 날짜·시각 계산은 time.ts 와 같은 규칙을
 * 인라인해 now 주입만으로 단독 실행 테스트가 되게 한다. (careStatusText.ts 와 같은 방식)
 */

import type { CareEvent, EventType } from '../types/events';

/**
 * 홈 "오늘 활동" 카운트 전용 이벤트 분류.
 * ⚠️ eventViews.ts 의 ACTIVITY_EVENT_TYPES 와 **다르다** (복약·워치 제외). 위 주석 참고.
 * ⚠️ 이 Set 은 "오늘 활동 요약 숫자" 에만 영향을 준다.
 *    careStatus / 마지막 활동 / 타임라인 분류는 건드리지 않는다.
 */
export const DAILY_LIVING_ACTIVITY_EVENT_TYPES: ReadonlySet<EventType> = new Set(
  ['motion_detected', 'door_opened', 'returned_home', 'left_home'],
);

export interface TodayActivitySummary {
  /** 오늘 발생한 생활 움직임 이벤트 수. truncated 면 하한값이다. */
  count: number;
  /** 카드에 바로 쓸 횟수 문구 — "12회" / truncated 면 "1840회 이상" */
  countText: string;
  /** 오늘 이벤트가 조회 안전 상한을 넘어 일부만 집계됐는가 */
  truncated: boolean;
  /** 오늘 첫 활동 시각 "오전 7:10". count 0 이거나 truncated 면 undefined (실제 첫 활동이 조회 창 밖). */
  firstAt?: string;
  /** 오늘 마지막 활동 시각 "오후 3:12". count 0 이면 undefined. */
  lastAt?: string;
  /** 홈에 바로 쓸 한 줄 문구 */
  text: string;
}

/** time.ts 의 isSameDay 와 동일 규칙 (순수 유지를 위해 인라인) */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "오전 7:10" — time.ts 의 formatClock 과 동일 규칙 (순수 유지를 위해 인라인) */
function clock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const isAm = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${isAm ? '오전' : '오후'} ${h12}:${m}`;
}

export interface TodayActivityOptions {
  /**
   * 오늘 이벤트가 조회 안전 상한(eventWindow.TODAY_EVENTS_SAFETY_CAP)에 걸려 최신 일부만
   * 들어왔는가. true 면 숫자를 "이상"으로 표시하고 첫 활동 시각은 만들지 않는다
   * (가장 이른 이벤트가 조회 창 밖에 있으므로 보이는 것 중 가장 이른 시각은 거짓이다).
   */
  truncated?: boolean;
}

export function buildTodayActivitySummary(
  events: CareEvent[],
  now: Date = new Date(),
  activityTypes: ReadonlySet<EventType> = DAILY_LIVING_ACTIVITY_EVENT_TYPES,
  options: TodayActivityOptions = {},
): TodayActivitySummary {
  const truncated = options.truncated === true;
  const todays = events
    .filter(
      (e) =>
        activityTypes.has(e.eventType) &&
        isSameLocalDay(new Date(e.occurredAt), now),
    )
    .sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

  if (todays.length === 0 && !truncated) {
    return { count: 0, countText: '0회', truncated: false, text: '아직 확인된 활동이 없어요' };
  }

  const count = todays.length;
  const lastAt = count > 0 ? clock(todays[count - 1].occurredAt) : undefined;

  if (truncated) {
    return {
      count,
      countText: `${count}회 이상`,
      truncated: true,
      firstAt: undefined,
      lastAt,
      text: lastAt ? `${count}번 이상 · 마지막 ${lastAt}` : `${count}번 이상`,
    };
  }

  const firstAt = clock(todays[0].occurredAt);
  const range = firstAt === lastAt ? firstAt : `${firstAt} ~ ${lastAt}`;

  return {
    count,
    countText: `${count}회`,
    truncated: false,
    firstAt,
    lastAt,
    text: `${count}번 · ${range}`,
  };
}
