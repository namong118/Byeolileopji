/**
 * 실시간 구독(onSnapshot) 동기화 상태 — 순수 로직.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────
 *  Firestore JS SDK(@firebase/firestore 4.17.1)는 네트워크가 끊겨도 onSnapshot 의 error
 *  콜백을 부르지 않는다. 캐시로 계속 동작하며, 끊김은 `snapshot.metadata.fromCache = true`
 *  로만 드러나고 그마저 `includeMetadataChanges: true` 로 구독해야 전달된다
 *  (QueryListener: 문서 변화 없는 syncState 변경은 includeMetadataChanges 일 때만 raise).
 *  → error 콜백만 보면 네트워크 끊김 중에도 오래된 "오늘도 별일 없어요" 가 계속 보인다.
 *
 * ── 상태 (내부 구분) ─────────────────────────────────────────────────
 *   live        서버에서 확인된 최신 스냅샷 (fromCache=false)
 *   cache_grace 캐시 스냅샷이지만 아직 유예 시간 이내 (일시적 끊김 / 앱 시작 직후 캐시 → 서버)
 *   offline     캐시 상태가 유예 시간(OFFLINE_STALE_AFTER_MS) 이상 지속 — SDK 가 자동 복구 대기
 *   failed      구독 오류로 종료됨 — 자동 복구 없음, 재구독(reload / AppState active) 필요
 *
 *  화면은 offline 과 failed 를 **같은 문구 / 같은 Hero 규칙**으로 보여준다 (isStreamStale).
 *  네트워크가 돌아오면 SDK 가 fromCache=false 스냅샷을 보내 live 로 돌아오고 표시가 사라진다.
 */

/** 캐시 상태가 이 시간 이상 이어지면 "최신 정보를 불러오지 못했어요" 로 표시한다. */
export const OFFLINE_STALE_AFTER_MS = 2 * 60_000;

export type StreamSyncKind = 'live' | 'cache_grace' | 'offline' | 'failed';

export interface StreamSync {
  /** 구독이 오류로 종료됐는가 (자동 복구 없음) */
  failed: boolean;
  /** 마지막으로 받은 스냅샷이 캐시(fromCache=true)였는가. 스냅샷을 아직 못 받았으면 true. */
  fromCache: boolean;
  /** 캐시 상태가 시작된 시각 (ISO). live 면 undefined. */
  cacheSince?: string;
  /** 서버에서 확인된 스냅샷을 마지막으로 받은 시각 (ISO). 화면의 "…까지 확인한 정보예요". */
  lastServerSyncAt?: string;
}

/** 구독 시작 시점 상태. 첫 스냅샷 전도 "캐시(미확인)" 로 보고 유예 시간을 잰다. */
export function initialStreamSync(now: Date, prev?: StreamSync): StreamSync {
  return {
    failed: false,
    fromCache: true,
    cacheSince: prev?.cacheSince ?? now.toISOString(),
    lastServerSyncAt: prev?.lastServerSyncAt,
  };
}

/** 스냅샷 수신 (onNext / getDocs). failed 는 해제된다 — 새 데이터가 왔으므로. */
export function applySnapshotSync(
  prev: StreamSync,
  snapshot: { fromCache: boolean },
  now: Date,
): StreamSync {
  if (!snapshot.fromCache) {
    return { failed: false, fromCache: false, cacheSince: undefined, lastServerSyncAt: now.toISOString() };
  }
  return {
    failed: false,
    fromCache: true,
    cacheSince: prev.fromCache && prev.cacheSince ? prev.cacheSince : now.toISOString(),
    lastServerSyncAt: prev.lastServerSyncAt,
  };
}

/** 구독 오류 (onError). 데이터는 마지막 상태 그대로 — 갱신만 멈춘다. */
export function applyStreamFailure(prev: StreamSync): StreamSync {
  return { ...prev, failed: true };
}

export function streamSyncKind(
  s: StreamSync,
  now: Date,
  staleAfterMs: number = OFFLINE_STALE_AFTER_MS,
): StreamSyncKind {
  if (s.failed) return 'failed';
  if (!s.fromCache) return 'live';
  const since = s.cacheSince ? Date.parse(s.cacheSince) : NaN;
  if (Number.isNaN(since)) return 'offline'; // 시작 시각을 모르면 보수적으로
  return now.getTime() - since >= staleAfterMs ? 'offline' : 'cache_grace';
}

/** 화면에 "최신 정보를 불러오지 못했어요" 를 띄워야 하는가 (offline / failed 동일 취급). */
export function isStreamStale(s: StreamSync, now: Date, staleAfterMs?: number): boolean {
  const kind = streamSyncKind(s, now, staleAfterMs);
  return kind === 'offline' || kind === 'failed';
}

/** 사용자 문구 — offline / failed 공통. */
export const STALE_DATA_MESSAGE =
  '최신 정보를 불러오지 못했어요. 화면의 정보가 지금 상태와 다를 수 있어요.';
