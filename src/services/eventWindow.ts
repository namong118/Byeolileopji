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
