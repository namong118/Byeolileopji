/**
 * Firestore REST API 헬퍼.
 *
 * Phase 5 STEP 5.3-A — service-account OAuth2 Bearer 토큰으로 인증한다
 * (firestoreAuth.js, FCM 과 동일 secret 재사용). `?key=` 공개 API 키 방식은
 * 제거했다 — 그 값은 애초에 인증이 아니었다(Firestore Rules 가 열려 있어야만
 * 동작하는 DEVELOPMENT ONLY 방식). Rules 를 좁혀도(Phase 5.3-D) 이 Worker 는
 * OAuth 인증 요청이라 Rules 를 우회하는 Admin 경로로 계속 동작한다.
 */

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

export class FirestoreError extends Error {
  constructor(status, detail) {
    super(`Firestore ${status}: ${detail}`);
    this.name = 'FirestoreError';
    this.status = status;
    this.detail = detail;
  }
}

// ── 평문 객체 ↔ Firestore REST value 표현 ────────────────────────────────

export function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === 'object') {
    return { mapValue: { fields: toFirestoreFields(v) } };
  }
  return { nullValue: null };
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, val] of Object.entries(obj)) fields[k] = toFirestoreValue(val);
  return fields;
}

export function fromFirestoreValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fromFirestoreFields(v.mapValue?.fields || {});
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(fromFirestoreValue);
  return undefined;
}

export function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, val] of Object.entries(fields || {})) out[k] = fromFirestoreValue(val);
  return out;
}

// ── REST 호출 ───────────────────────────────────────────────────────────

/** devices/{deviceId} 조회. 없으면 null. */
export async function getDevice(env, deviceId) {
  const url = `${base(env)}/devices/${encodeURIComponent(deviceId)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(await authHeaders(env)) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return fromFirestoreFields(doc.fields || {});
}

/** events 문서 생성. 생성된 문서 id 반환. */
export async function createEvent(env, eventObj) {
  const url = `${base(env)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
    body: JSON.stringify({ fields: toFirestoreFields(eventObj) }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return String(doc.name || '').split('/').pop();
}

/**
 * devices/{deviceId} 의 일부 필드만 갱신 (PATCH + updateMask).
 * Phase 4.1a 에서는 { lastEventAt: Date } 만 쓴다.
 */
export async function touchDevice(env, deviceId, fields) {
  const params = new URLSearchParams();
  for (const key of Object.keys(fields)) {
    params.append('updateMask.fieldPaths', key);
  }

  const url = `${base(env)}/devices/${encodeURIComponent(deviceId)}?${params}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(await authHeaders(env)) },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  return true;
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}
