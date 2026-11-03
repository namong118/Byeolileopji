/**
 * XIAO 판단 근거 스냅샷 — 이벤트와 사진을 맞추는 순수 함수 (RN 의존성 없음, Node smoke 에서 import).
 *
 * 펌웨어(DEMO_SNAPSHOT)는 최신 1장만 로컬 /snapshot 으로 제공하고, 이벤트에는 번호(snapshotSeq)만 넣는다.
 * 사진은 서버로 가지 않는다. 웹 데모는 새 이벤트가 오면 /snapshot 을 받아
 * 응답 헤더 X-Snapshot-Seq 가 이벤트 번호와 같을 때만 그 줄에 붙인다.
 */

import type { CareEvent } from '../types/events';

export function readSnapshotSeq(event: CareEvent): number | undefined {
  const n = event.metadata?.snapshotSeq;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export type SnapshotMatch = 'match' | 'stale' | 'unknown';

/**
 * @param headerSeq 응답의 X-Snapshot-Seq (CORS 로 못 읽으면 null)
 *   - 같음 → 'match' (붙인다)
 *   - 다름 → 'stale' (그 사이 다음 확정이 덮어썼다 → "사진 없음")
 *   - 헤더 없음 → 'unknown' (번호 확인 불가. 이벤트 직후 받은 최신 1장이므로 붙인다)
 */
export function matchSnapshot(eventSeq: number, headerSeq: string | null): SnapshotMatch {
  if (headerSeq === null || headerSeq.trim() === '') return 'unknown';
  const n = Number(headerSeq);
  if (!Number.isSafeInteger(n)) return 'unknown';
  return n === eventSeq ? 'match' : 'stale';
}

/**
 * 화면을 연 뒤 들어온 이벤트인가. 그 전 이벤트의 사진은 이미 덮어써졌을 수 있어 받지 않는다.
 * graceMs: 서버 시각과 브라우저 시각 차이 허용.
 */
export function isFreshSnapshotEvent(
  event: CareEvent,
  sinceMs: number,
  graceMs = 10_000,
): boolean {
  if (readSnapshotSeq(event) === undefined) return false;
  const t = Date.parse(event.occurredAt);
  return Number.isFinite(t) && t >= sinceMs - graceMs;
}
