/**
 * 서버 계산 careStatus 스냅샷 → Firestore **WRITE** (Phase 4.3 STEP B-2).
 *
 *   CareStatusSnapshot  (STEP A/B-1 compute 결과)
 *        │  serializeCareStatusSnapshot()   ← src/services/careStatusSnapshotDoc.ts  (공유, 순수)
 *        ▼
 *   CareStatusSnapshotDoc  (평문 · 모든 키 emit · timestamp = Date · 없으면 null)
 *        │  toFirestoreFields()             ← firestore.js
 *        ▼
 *   PATCH …/careStatus/{careRecipientId}?updateMask=<모든 필드>   (create-or-overwrite)
 *
 * ── idempotent ───────────────────────────────────────────────────────
 *  문서 id = careRecipientId 고정, updateMask 에 문서의 **모든 필드**를 넣어
 *  전체 replace 한다. 같은 스냅샷을 두 번 write → 동일한 문서. event history 처럼
 *  새 문서를 쌓지 않는다. (`createEvent` 의 auto-id POST 와 대비되는 deterministic PATCH)
 *
 * ── 실패 처리 ────────────────────────────────────────────────────────
 *  HTTP 실패를 성공으로 **삼키지 않는다**. `FirestoreError` 를 throw 해 호출자에게
 *  전달한다. (best-effort 아님 — `/device-heartbeat` write 와 같은 정책. `lastEventAt`
 *  best-effort PATCH 와는 다르다.)
 *
 * ── 인증 ─────────────────────────────────────────────────────────────
 *  아직 **인증 없이** write 한다 (`firestore.rules`: careStatus create/update = `if true`,
 *  DEVELOPMENT ONLY). Phase 4.4 에서 service-account access token + rules `if false` 로 좁힌다.
 *
 * ⚠️ 이 파일은 cron / `scheduled()` 가 아니다. STEP B-4 의 `scheduled()` 가
 *    `computeAndWriteCareStatusSnapshot()` 를 호출하게 된다. 이전 스냅샷 비교(전환 감지)는
 *    STEP B-3 이다 — 여기서는 하지 않는다.
 * ⚠️ 로그에 secret(토큰 / API key / device key) 을 출력하지 않는다.
 */

import { FirestoreError, toFirestoreFields } from './firestore.js';
import { computeCareStatusFromFirestore } from './careStatusReader.js';
import { serializeCareStatusSnapshot } from '../../../src/services/careStatusSnapshotDoc.ts';

const HOST = 'https://firestore.googleapis.com/v1';

/** 서버 계산 상태 스냅샷을 저장하는 top-level 컬렉션 (raw events/devices 와 분리). */
export const CARE_STATUS_COLLECTION = 'careStatus';

function base(env) {
  if (!env.FIREBASE_PROJECT_ID) throw new FirestoreError(500, 'FIREBASE_PROJECT_ID not set');
  return `${HOST}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

/**
 * `careStatus/{careRecipientId}` 문서를 스냅샷으로 덮어쓴다 (create-or-update, idempotent).
 *
 * @param env  Worker env (FIREBASE_PROJECT_ID 등)
 * @param careRecipientId  대상자 id — 문서 id 이자 필드
 * @param snapshot  computeCareStatusSnapshot() / computeCareStatusFromFirestore() 결과
 * @returns {Promise<{ path: string, doc: object }>} 저장 경로 + 직렬화된 평문 문서
 * @throws {FirestoreError} Firestore HTTP 실패 시 (호출자가 실패를 알 수 있어야 한다)
 */
export async function writeCareStatusSnapshot(env, careRecipientId, snapshot) {
  // serialize 는 순수 — careRecipientId 누락 / computedAt 불량이면 여기서 throw.
  const doc = serializeCareStatusSnapshot(snapshot, careRecipientId);

  const params = new URLSearchParams();
  // 문서의 모든 필드를 mask 에 넣는다 → 이전 값이 무엇이든 전체 replace (deterministic).
  for (const key of Object.keys(doc)) params.append('updateMask.fieldPaths', key);
  if (env.FIREBASE_API_KEY) params.set('key', env.FIREBASE_API_KEY);

  const path = `${CARE_STATUS_COLLECTION}/${encodeURIComponent(careRecipientId)}`;
  const url = `${base(env)}/${path}?${params}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(doc) }),
  });
  if (!res.ok) {
    // detail 은 safeText(응답 본문 앞 500자) — Firestore 오류 메시지엔 secret 이 없다.
    throw new FirestoreError(res.status, await safeText(res));
  }

  return { path, doc };
}

/**
 * READ → normalize → compute → serialize → WRITE 전체 흐름 한 줄.
 * STEP B-4 의 `scheduled()` 가 이 함수를 호출하게 된다.
 * (STEP B-3 은 write 앞에 "이전 스냅샷 read + 비교" 를 끼워넣는다.)
 *
 * @param env
 * @param opts  computeCareStatusFromFirestore 와 동일 — { careRecipientId, deviceId, thresholds, now?, eventLimit? }
 * @returns {Promise<{ input, snapshot, path, doc }>}
 * @throws Firestore READ 또는 WRITE 실패 시
 */
export async function computeAndWriteCareStatusSnapshot(env, opts) {
  const { input, snapshot } = await computeCareStatusFromFirestore(env, opts);
  const { path, doc } = await writeCareStatusSnapshot(env, opts.careRecipientId, snapshot);
  return { input, snapshot, path, doc };
}
