/**
 * Firestore REST **읽기 전용** 헬퍼 — Phase 4.3 STEP B-1.
 *
 * 서버 상태 판정(cron, STEP B 이후)에 필요한 최소 데이터만 조회한다.
 * WRITE 없음. 기존 firestore.js 의 value 변환 헬퍼를 재사용한다.
 *
 * Phase 5 STEP 5.3-A — service-account OAuth2 Bearer 로 인증한다 (firestoreAuth.js).
 */

import { FirestoreError, fromFirestoreFields } from './firestore.js';
import { getFirestoreAccessToken } from './firestoreAuth.js';

const HOST = 'https://firestore.googleapis.com/v1';

function base(env) {
  if (!env.FIREBASE_PROJECT_ID) throw new FirestoreError(500, 'FIREBASE_PROJECT_ID not set');
  return `${HOST}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function authHeaders(env) {
  const token = await getFirestoreAccessToken(env);
  return { authorization: `Bearer ${token}` };
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

/**
 * devices/{deviceId} 조회. 문서가 없으면 null.
 * (getDevice 와 동일한 point read — 상태 판정에서도 그대로 쓴다.)
 */
export async function readDeviceDoc(env, deviceId) {
  const url = `${base(env)}/devices/${encodeURIComponent(deviceId)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(await authHeaders(env)) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return fromFirestoreFields(doc.fields || {});
}

/** runQuery 실행 → 문서 행만 평문으로. ({readTime} 등 non-document 항목 스킵) */
async function runEventsQuery(env, structuredQuery) {
  const url = `${base(env)}:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));

  const rows = await res.json();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row && row.document;
    if (!doc || !doc.fields) continue;
    const fields = fromFirestoreFields(doc.fields);
    out.push({
      // 병합 시 중복 제거용 문서 id (createEvent 와 같은 방식으로 name 끝부분)
      id: String(doc.name || '').split('/').pop() || undefined,
      eventType: typeof fields.eventType === 'string' ? fields.eventType : undefined,
      // Firestore REST timestampValue 는 RFC3339 문자열로 온다.
      occurredAt: typeof fields.occurredAt === 'string' ? fields.occurredAt : undefined,
    });
  }
  return out;
}

const eq = (fieldPath, stringValue) => ({
  fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue } },
});

/**
 * events 조회 — `careRecipientId == X` + `occurredAt DESC` + `limit N`.
 *
 * 기존 앱 쿼리와 같은 조합이며 복합 인덱스(careRecipientId ASC + occurredAt DESC)를 쓴다.
 * eventType 필터 없이 최근 N건을 받아 normalizeCareStatusInput 이 ACTIVITY_EVENT_TYPES 로
 * 스캔한다 (lastActivityAt / hasAnyEvents 용).
 *
 * ⚠️ "최근 N건" 은 시간 기준 판정(SOS lookback 12h)을 담보하지 못한다 — motion 이 계속되면
 *    N건이 몇 분 만에 찬다. sos 는 queryLatestEventOfType() 로 따로 읽는다.
 *
 * @returns {Promise<Array<{ id?: string, eventType?: string, occurredAt?: string }>>}
 */
export async function queryRecentEvents(env, careRecipientId, limit = 100) {
  return runEventsQuery(env, {
    from: [{ collectionId: 'events' }],
    where: eq('careRecipientId', careRecipientId),
    orderBy: [{ field: { fieldPath: 'occurredAt' }, direction: 'DESCENDING' }],
    limit,
  });
}

/**
 * 특정 eventType 의 가장 최근 1건 — `careRecipientId == X` + `eventType == T`
 * + `occurredAt DESC` + `limit 1`.
 *
 * 최근 N건 조회 창 밖으로 밀려난 sos_triggered 를 놓치지 않기 위해 쓴다. lookback/TTL
 * 판정은 하지 않는다 (그건 공유 코어 deriveCareStatus 담당) — 최신 1건만 넘긴다.
 *
 * ⚠️ 복합 인덱스 필요: events (careRecipientId ASC, eventType ASC, occurredAt DESC)
 *    (firestore.indexes.json). 인덱스가 없으면 Firestore 가 400 FAILED_PRECONDITION →
 *    FirestoreError throw → Cron invocation 실패 (조용히 SOS 를 빠뜨리지 않는다).
 *
 * @returns {Promise<Array<{ id?: string, eventType?: string, occurredAt?: string }>>} 0 또는 1건
 */
export async function queryLatestEventOfType(env, careRecipientId, eventType) {
  return runEventsQuery(env, {
    from: [{ collectionId: 'events' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [eq('careRecipientId', careRecipientId), eq('eventType', eventType)],
      },
    },
    orderBy: [{ field: { fieldPath: 'occurredAt' }, direction: 'DESCENDING' }],
    limit: 1,
  });
}
