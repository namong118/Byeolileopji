/**
 * Firestore REST **읽기 전용** 헬퍼 — Phase 4.3 STEP B-1.
 *
 * 서버 상태 판정(cron, STEP B 이후)에 필요한 최소 데이터만 조회한다.
 * WRITE 없음. 기존 firestore.js 의 value 변환 헬퍼를 재사용한다.
 *
 * ⚠️ 이 Worker 는 아직 Firestore 에 **인증 없이** 접근한다 (firestore.rules 가
 *    events / devices read 를 `if true` 로 열어둠 — DEVELOPMENT ONLY).
 *    Phase 4.4 에서 규칙을 좁히면 service-account access token 이 필요하다.
 */

import { FirestoreError, fromFirestoreFields } from './firestore.js';

const HOST = 'https://firestore.googleapis.com/v1';

function base(env) {
  if (!env.FIREBASE_PROJECT_ID) throw new FirestoreError(500, 'FIREBASE_PROJECT_ID not set');
  return `${HOST}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function keyParam(env) {
  return env.FIREBASE_API_KEY ? `?key=${encodeURIComponent(env.FIREBASE_API_KEY)}` : '';
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
  const url = `${base(env)}/devices/${encodeURIComponent(deviceId)}${keyParam(env)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return fromFirestoreFields(doc.fields || {});
}

/**
 * events 조회 — `careRecipientId == X` + `occurredAt DESC` + `limit N`.
 *
 * ⚠️ 이 조합은 기존 앱 쿼리와 **동일**하며 이미 게시된 복합 인덱스
 *    (firestore.indexes.json: careRecipientId ASC + occurredAt DESC)를 그대로 쓴다.
 *    새 인덱스가 필요 없다.
 *
 * eventType 별 필터는 하지 않는다 (그러려면 새 인덱스 필요 — STEP B-2 에서 검토).
 * 대신 최근 N건을 받아 normalizeCareStatusInput 이 ACTIVITY_EVENT_TYPES 로 스캔한다.
 *
 * @returns {Promise<Array<{ eventType?: string, occurredAt?: string }>>}
 */
export async function queryRecentEvents(env, careRecipientId, limit = 100) {
  const url = `${base(env)}:runQuery${keyParam(env)}`;
  const structuredQuery = {
    from: [{ collectionId: 'events' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'careRecipientId' },
        op: 'EQUAL',
        value: { stringValue: careRecipientId },
      },
    },
    orderBy: [{ field: { fieldPath: 'occurredAt' }, direction: 'DESCENDING' }],
    limit,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));

  const rows = await res.json();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row && row.document;
    if (!doc || !doc.fields) continue; // {readTime} 등 non-document 항목 스킵
    const fields = fromFirestoreFields(doc.fields);
    out.push({
      eventType: typeof fields.eventType === 'string' ? fields.eventType : undefined,
      // Firestore REST timestampValue 는 RFC3339 문자열로 온다.
      occurredAt: typeof fields.occurredAt === 'string' ? fields.occurredAt : undefined,
    });
  }
  return out;
}
