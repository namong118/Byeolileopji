/**
 * 앱 이벤트 조회 창(window) 정의 + 병합 — 순수 로직.
 *
 * ── 왜 조회를 셋으로 나누는가 ────────────────────────────────────────
 *  판정·표시는 **시간 기준**(SOS lookback 12h, "오늘" 활동 수/첫 활동 시각)인데,
 *  예전 단일 쿼리는 **개수 기준**(최근 500건)이었다. 펌웨어 motion cooldown 이 5초라
 *  활동이 계속되면 500건이 금방 차고, 그 밖으로 밀려난 SOS / 오늘 이른 시각의 활동이
 *  에러 없이 사라졌다. 그래서 FirestoreEventRepository 는 세 조회를 합쳐 쓴다:
 *
 *   1. recent  — 최근 RECENT_EVENTS_LIMIT 건. 마지막 활동 / 이벤트 존재 여부용.
 *                (0시 직후처럼 오늘 이벤트가 없을 때도 마지막 활동을 알아야 한다.)
 *   2. today   — occurredAt >= 오늘 00:00(기기 로컬) 범위. 오늘 활동 수 / 첫 활동 / 타임라인.
 *                비용 보호용 안전 상한 TODAY_EVENTS_SAFETY_CAP 을 두고, 상한을 넘으면
 *                todayTruncated=true 로 **잘렸다는 사실을 드러낸다**(조용히 축소 금지).
 *   3. sos     — 최신 sos_triggered 1건. EMERGENCY 판정용 (lookback/TTL 은 deriveCareStatus 담당).
 *
 *  세 결과를 id 로 중복 제거해 하나의 목록으로 만든다 → deriveEventViews / deriveCareStatus
 *  입력 형태는 그대로다.
 *
 * ── "오늘" = 기기 로컬 자정 ─────────────────────────────────────────
 *  eventViews.ts / todayActivity.ts 의 isSameLocalDay 와 같은 규칙이다 (KST 기기 = KST 00:00).
 *
 * firebase / react import 없음 → Node 스모크에서 단독 실행 가능.
 */

import type { CareEvent } from '../types/events';

/** recent 조회 limit. 마지막 활동 / 이벤트 존재 여부 전용 (오늘 통계는 today 조회가 담당). */
export const RECENT_EVENTS_LIMIT = 100;

/** today 조회 안전 상한. 실제 쿼리는 CAP+1 건을 요청해 초과 여부를 판정한다. */
export const TODAY_EVENTS_SAFETY_CAP = 2000;

/** 기기 로컬 타임존 기준 오늘 00:00:00.000 */
export function startOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * today 조회 결과(CAP+1 건까지, 최신 우선) → 상한까지 자른 목록 + 잘림 여부.
 * CAP 건을 정확히 받은 것만으로는 잘렸다고 보지 않는다 (CAP+1 번째가 있어야 잘림).
 */
export function capTodayEvents(
  todayNewestFirst: readonly CareEvent[],
  cap: number = TODAY_EVENTS_SAFETY_CAP,
): { events: CareEvent[]; truncated: boolean } {
  const truncated = todayNewestFirst.length > cap;
  return {
    events: truncated ? todayNewestFirst.slice(0, cap) : [...todayNewestFirst],
    truncated,
  };
}

/** id 기준 중복 제거 병합. 정렬은 deriveEventViews 가 다시 한다. */
export function mergeEventsById(...lists: readonly (readonly CareEvent[])[]): CareEvent[] {
  const seen = new Set<string>();
  const out: CareEvent[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

export interface EventWindowParts {
  recent: readonly CareEvent[];
  /** today 조회 원본 (CAP+1 건까지, 최신 우선) */
  today: readonly CareEvent[];
  latestSos: readonly CareEvent[];
}

export interface EventWindowResult {
  /** 세 조회의 합집합 (id 중복 제거) */
  events: CareEvent[];
  /** 오늘 이벤트가 안전 상한을 넘어 일부만 담겼는가 */
  todayTruncated: boolean;
}

export function combineEventWindows(
  parts: EventWindowParts,
  cap: number = TODAY_EVENTS_SAFETY_CAP,
): EventWindowResult {
  const today = capTodayEvents(parts.today, cap);
  return {
    events: mergeEventsById(today.events, parts.recent, parts.latestSos),
    todayTruncated: today.truncated,
  };
}

/**
 * 날짜가 바뀐 직후 이전 today 결과에서 새 날짜(dayStartMs 이후) 이벤트만 남긴다.
 *
 * 이전 today 쿼리(>= 어제 00:00)는 새 today 범위의 상위집합이고 최신 우선이므로,
 * 거른 결과에 capTodayEvents 를 그대로 적용하면 잘림 판정도 맞다:
 *  - 잘린 지점이 어제 쪽이면 거른 길이 ≤ CAP → 잘림 아님 (오늘 이벤트는 전부 들어 있음)
 *  - CAP+1 건이 모두 오늘이면 그대로 CAP+1 → 잘림
 * 새 today 스냅샷이 오기 전에도 "어제 데이터" 나 "어제의 잘림 표시" 가 보이지 않게 한다.
 */
export function rollTodayWindow(
  todayNewestFirst: readonly CareEvent[],
  dayStartMs: number,
): CareEvent[] {
  return todayNewestFirst.filter((e) => Date.parse(e.occurredAt) >= dayStartMs);
}

// ── 세 조회 구독 조정 (Firestore 비의존 — 저장소가 구독 함수를 주입한다) ──────────

export type EventWindowKey = keyof EventWindowParts;

/** 단일 쿼리 구독. onNext 는 최신 우선 목록, onError 이후에는 더 호출되지 않는다(onSnapshot 과 동일). */
export type EventWindowSource = (
  onNext: (events: CareEvent[]) => void,
  onError: (error: unknown) => void,
) => () => void;

export interface EventWindowSubscriptionDeps {
  recent: EventWindowSource;
  /** 주어진 로컬 자정 이후 범위의 today 구독을 만든다 (날짜가 바뀌면 다시 호출된다) */
  today: (dayStart: Date) => EventWindowSource;
  latestSos: EventWindowSource;
  listener: (events: CareEvent[], meta: { todayTruncated: boolean }) => void;
  /** 세 구독 중 하나라도 오류가 나면 **한 번** 호출된다. 그 이후 listener 는 호출되지 않는다. */
  onError?: (error: unknown, source: EventWindowKey) => void;
  now?: () => Date;
  cap?: number;
}

export interface EventWindowSubscription {
  /** 로컬 날짜가 바뀌었으면 today 구독을 새 자정 기준으로 다시 열고 true. (타이머 / AppState active) */
  checkDayRollover(): boolean;
  unsubscribe(): void;
}

/**
 * recent / today / sos 세 구독을 하나로 조정한다.
 *
 * - 세 구독이 **모두 첫 결과를 받은 뒤에만** listener 를 호출한다 (SOS 없는 목록으로
 *   NORMAL → EMERGENCY 가 깜박이거나 오늘 활동 수가 잠깐 작게 보이지 않게).
 * - 어느 구독이든 오류가 나면 **실패 상태로 고정**하고 onError 를 한 번 부른다. 이후 다른
 *   구독이 갱신돼도 listener 를 부르지 않는다 — 오래된 조각(예: 멈춘 SOS)과 새 조각을 섞은
 *   목록으로 판정하지 않는다. 화면은 onError 를 받아 "최신 정보를 불러오지 못했어요" 를
 *   드러낸다 (careStore.realtimeError). 복구는 호출자가 새 구독을 만드는 것이다.
 */
export function createEventWindowSubscription(
  deps: EventWindowSubscriptionDeps,
): EventWindowSubscription {
  const now = deps.now ?? (() => new Date());
  const parts: Partial<EventWindowParts> = {};
  let failed = false;
  let closed = false;

  const emit = () => {
    if (failed || closed) return;
    if (!parts.recent || !parts.today || !parts.latestSos) return;
    const r = combineEventWindows(parts as EventWindowParts, deps.cap);
    deps.listener(r.events, { todayTruncated: r.todayTruncated });
  };

  const open = (source: EventWindowSource, key: EventWindowKey) =>
    source(
      (events) => {
        parts[key] = events;
        emit();
      },
      (error) => {
        if (failed || closed) return;
        failed = true;
        deps.onError?.(error, key);
      },
    );

  const unsubRecent = open(deps.recent, 'recent');
  const unsubSos = open(deps.latestSos, 'latestSos');
  let dayStartMs = startOfLocalDay(now()).getTime();
  let unsubToday = open(deps.today(new Date(dayStartMs)), 'today');

  return {
    checkDayRollover() {
      if (closed) return false;
      const next = startOfLocalDay(now()).getTime();
      if (next === dayStartMs) return false;
      dayStartMs = next;
      unsubToday();
      if (parts.today) parts.today = rollTodayWindow(parts.today, dayStartMs);
      emit(); // 새 today 스냅샷 전이라도 어제 데이터 / 어제 잘림 표시를 즉시 걷어낸다
      unsubToday = open(deps.today(new Date(dayStartMs)), 'today');
      return true;
    },
    unsubscribe() {
      closed = true;
      unsubRecent();
      unsubToday();
      unsubSos();
    },
  };
}
