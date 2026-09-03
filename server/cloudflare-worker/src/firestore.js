/**
 * Firestore REST API 헬퍼.
 *
 * ⚠️ 이 Worker 는 Firestore 에 **인증 없이** 접근한다.
 *    Phase 2.5 의 개발용 규칙(firestore.rules)이 events create / devices read 를
 *    `if true` 로 열어 두었기 때문에 가능하다. **DEVELOPMENT ONLY.**
 *
 *    Phase 4 에서 규칙을 좁히면, 여기서 서비스 계정으로 OAuth2 access token 을
 *    발급(JWT 서명)해 Authorization 헤더를 붙여야 한다. 그 전까지는 토큰이 필요 없다.
 */

const HOST = 'https://firestore.googleapis.com/v1';

function base(env) {
  if (!env.FIREBASE_PROJECT_ID) throw new FirestoreError(500, 'FIREBASE_PROJECT_ID not set');
  return `${HOST}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function keyParam(env) {
  return env.FIREBASE_API_KEY ? `?key=${encodeURIComponent(env.FIREBASE_API_KEY)}` : '';
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
  const url = `${base(env)}/devices/${encodeURIComponent(deviceId)}${keyParam(env)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return fromFirestoreFields(doc.fields || {});
}

/** events 문서 생성. 생성된 문서 id 반환. */
export async function createEvent(env, eventObj) {
  const url = `${base(env)}/events${keyParam(env)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(eventObj) }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  const doc = await res.json();
  return String(doc.name || '').split('/').pop();
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}
