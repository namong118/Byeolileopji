/**
 * careStatus 문서 persistence — **WRITE 새 스냅샷** (Phase 4.3 STEP B-2)
 *                                + **READ 이전 스냅샷 & 전환 감지 흐름** (Phase 4.3 STEP B-3).
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
 *  전환을 감지했더라도 스냅샷 write 가 실패하면 함수가 throw 한다 → 호출자는
 *  "전환이 확정 저장됐다" 고 취급하면 안 된다 (transition result 를 반환하지 않는다).
 *
 * ── 이전 스냅샷 READ (B-3) ───────────────────────────────────────────
 *  `readCareStatusDoc()` 는 careStatus/{id} point read. **404 → null (초기 상태)**,
 *  403/500 등 → throw. 에러를 null 로 삼키지 않는다. `parseCareStatusDoc()` 가
 *  Firestore REST fields 를 검증된 identity(+metadata) 로 변환한다 — status /
 *  deviceHealth 가 알려진 enum 이 아니면 throw (조용히 NORMAL 로 대체하지 않는다).
 *
 * ── 인증 ─────────────────────────────────────────────────────────────
 *  아직 **인증 없이** read/write 한다 (`firestore.rules`: careStatus read/create/update
 *  = `if true`, DEVELOPMENT ONLY). Phase 4.4 에서 service-account + rules `if false`.
 *
 * ⚠️ 이 파일은 cron / `scheduled()` 가 아니다. STEP B-4 의 `scheduled()` 가
 *    `computeCompareAndWriteCareStatusSnapshot()` 를 호출하게 된다.
 * ⚠️ FCM · notification write · transition history write 없음. 전환 결과는 반환값뿐.
 * ⚠️ 로그에 secret(토큰 / API key / device key) 을 출력하지 않는다.
 */

import { FirestoreError, fromFirestoreFields, toFirestoreFields } from './firestore.js';
import { computeCareStatusFromFirestore } from './careStatusReader.js';
import { serializeCareStatusSnapshot } from '../../../src/services/careStatusSnapshotDoc.ts';
import {
  deriveCareStatusTransition,
  isCareStatus,
  isDeviceHealth,
} from '../../../src/services/careStatusTransition.ts';

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
 * READ → normalize → compute → serialize → WRITE 전체 흐름 한 줄 (Phase 4.3 STEP B-2 entry).
 * 이전 스냅샷 비교를 원하면 `computeCompareAndWriteCareStatusSnapshot()` (B-3) 를 쓴다.
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

// ─────────────────────────────────────────────────────────────────────
//  Phase 4.3 STEP B-3 — 이전 스냅샷 READ + 전환 감지
// ─────────────────────────────────────────────────────────────────────

/**
 * careStatus/{careRecipientId} Firestore REST fields → 검증된 normalized 스냅샷.
 * 순수. B-2 serialize 스키마의 역방향 (전환 비교에 필요한 필드 + metadata).
 *
 * status / deviceHealth 가 알려진 enum 이 아니면 **throw** (조용히 대체 금지).
 * schemaVersion 불일치는 throw 하지 않는다 — 전환 identity(status/deviceHealth) 는
 * enum 이 안정적이라 forward-compatible. computedAt 없음도 throw 아님 (identity 아님).
 *
 * @param {Record<string, unknown>} fields  Firestore document.fields
 * @returns {{ careRecipientId?: string, schemaVersion?: number, status: string,
 *            reason?: string, deviceHealth: string, deviceHealthReason?: string,
 *            computedAt?: string }}
 * @throws {FirestoreError} status / deviceHealth 가 malformed 이면 (422)
 */
export function parseCareStatusDoc(fields) {
  const raw = fromFirestoreFields(fields || {});

  if (!isCareStatus(raw.status)) {
    throw new FirestoreError(
      422,
      `careStatus doc: invalid status ${JSON.stringify(raw.status)}`,
    );
  }
  if (!isDeviceHealth(raw.deviceHealth)) {
    throw new FirestoreError(
      422,
      `careStatus doc: invalid deviceHealth ${JSON.stringify(raw.deviceHealth)}`,
    );
  }

  const str = (v) => (typeof v === 'string' && v !== '' ? v : undefined);
  return {
    careRecipientId: str(raw.careRecipientId),
    schemaVersion:
      typeof raw.schemaVersion === 'number' ? raw.schemaVersion : undefined,
    status: raw.status,
    reason: str(raw.reason),
    deviceHealth: raw.deviceHealth,
    deviceHealthReason: str(raw.deviceHealthReason),
    // Firestore REST timestampValue → RFC3339 문자열 (fromFirestoreValue 가 그대로 준다)
    computedAt: str(raw.computedAt),
  };
}

/**
 * careStatus/{careRecipientId} point read.
 *
 * @returns {Promise<object|null>}  parseCareStatusDoc 결과, 또는 문서가 없으면 null (초기 상태)
 * @throws {FirestoreError}  404 를 제외한 HTTP 실패 시 (403/500 등을 null 로 삼키지 않는다)
 */
export async function readCareStatusDoc(env, careRecipientId) {
  if (!careRecipientId) throw new Error('readCareStatusDoc: careRecipientId required');

  const params = new URLSearchParams();
  if (env.FIREBASE_API_KEY) params.set('key', env.FIREBASE_API_KEY);
  const qs = params.toString();

  const path = `${CARE_STATUS_COLLECTION}/${encodeURIComponent(careRecipientId)}`;
  const url = `${base(env)}/${path}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null; // 이전 스냅샷 없음 = 초기 상태 (에러 아님)
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));

  const json = await res.json();
  return parseCareStatusDoc(json.fields || {});
}

/**
 * READ raw source → normalize → compute NEXT → **READ previous careStatus** →
 * **detect transition (WRITE 전)** → serialize + WRITE NEXT → return transition.
 *
 * STEP B-4 의 `scheduled()` 가 이 함수를 호출하게 된다.
 *
 * 순서 주의: 전환은 **write 전에** 계산한다. write 후 previous 를 읽으면 이미
 * next 로 덮여 비교가 불가능하다.
 *
 * 실패 정책: previous READ 실패(404 제외) 또는 NEXT WRITE 실패 → throw.
 *   → 호출자는 transition 결과를 받지 못한다 (전환이 확정 저장됐다고 보면 안 된다).
 *   FCM 은 아직 없으므로 side effect 없음. B-4/Phase 4.4 에서 "write 성공 후 알림"
 *   순서를 지킬 수 있게 write 를 transition 계산 뒤에 둔다.
 *
 * @param env
 * @param opts  computeCareStatusFromFirestore 와 동일 — { careRecipientId, deviceId, thresholds, now?, eventLimit? }
 * @returns {Promise<{ input, snapshot, previous, transition, path, doc }>}
 * @throws Firestore READ(raw source / previous careStatus, 404 제외) 또는 WRITE 실패 시
 */
export async function computeCompareAndWriteCareStatusSnapshot(env, opts) {
  // 1. raw source READ → normalize → compute NEXT 스냅샷
  const { input, snapshot } = await computeCareStatusFromFirestore(env, opts);

  // 2. 이전 careStatus 스냅샷 READ (WRITE 전!). 없으면 null (초기 상태).
  const previous = await readCareStatusDoc(env, opts.careRecipientId);

  // 3. 전환 감지 (순수). 두 축 독립, reason 무관, 초기 스냅샷 = baseline.
  const transition = deriveCareStatusTransition(previous, {
    status: snapshot.person.status,
    deviceHealth: snapshot.device.health,
  });

  // 4. NEXT 스냅샷 WRITE. 실패하면 여기서 throw → transition 반환 안 함.
  const { path, doc } = await writeCareStatusSnapshot(env, opts.careRecipientId, snapshot);

  return { input, snapshot, previous, transition, path, doc };
}
