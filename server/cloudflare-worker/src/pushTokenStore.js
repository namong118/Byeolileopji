/**
 * 보호자 푸시 토큰 조회/정리 — Phase 4.4 STEP 1.
 *
 *   pushTokens/{tokenId}
 *     { token, platform, careRecipientId, enabled, createdAt, updatedAt }
 *
 * ── 최소 모델 ──────────────────────────────────────────────────────
 *  Firebase Auth / guardian 관계 모델이 아직 없다. 이번 단계는 **dev-care-recipient
 *  에 연결된 개발용 보호자 토큰을 저장/조회할 수 있는 최소 구조**만 만든다.
 *  guardianUid / 관계 검증 / 토큰 회전 정책 / TTL 은 Phase 4.4 Auth 단계로 미룬다.
 *
 * ── 인증 ───────────────────────────────────────────────────────────
 *  아직 **인증 없이** read/write 한다 (`firestore.rules` pushTokens = DEVELOPMENT ONLY).
 *  Phase 4.4 Auth 이후: read = 서버(service-account)만, write = 토큰 소유 guardian.
 *
 * ── 토큰 값 취급 ───────────────────────────────────────────────────
 *  registration token 을 **로그에 출력하지 않는다**. 문서 id 와 개수만 로깅 대상.
 *
 * ── 쿼리 인덱스 ────────────────────────────────────────────────────
 *  `careRecipientId == X` 단일 fieldFilter 만 사용한다 (기존 events 쿼리와 동일 패턴).
 *  `enabled == true` 복합 필터는 새 인덱스가 필요하므로 **코드에서 필터링**한다.
 */

import { FirestoreError, fromFirestoreFields, toFirestoreFields } from './firestore.js';

const HOST = 'https://firestore.googleapis.com/v1';

/** 보호자 푸시 토큰 컬렉션 (top-level, careStatus/devices 와 같은 레벨). */
export const PUSH_TOKENS_COLLECTION = 'pushTokens';

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
 * `pushTokens` 에서 `careRecipientId == X` 문서를 조회한다.
 * `enabled === false` 는 코드에서 제거한다 (복합 인덱스 불필요).
 *
 * @returns {Promise<Array<{ id: string, token: string, platform?: string, enabled: boolean }>>}
 * @throws {FirestoreError} runQuery non-2xx
 */
export async function queryGuardianPushTokens(env, careRecipientId) {
  if (!careRecipientId) throw new Error('queryGuardianPushTokens: careRecipientId required');

  const url = `${base(env)}:runQuery${keyParam(env)}`;
  const structuredQuery = {
    from: [{ collectionId: PUSH_TOKENS_COLLECTION }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'careRecipientId' },
        op: 'EQUAL',
        value: { stringValue: careRecipientId },
      },
    },
    limit: 50,
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
    if (!doc || !doc.fields) continue; // {readTime} 등 non-document 스킵
    const f = fromFirestoreFields(doc.fields);
    const token = typeof f.token === 'string' ? f.token : undefined;
    if (!token) continue;
    out.push({
      id: String(doc.name || '').split('/').pop(),
      token,
      platform: typeof f.platform === 'string' ? f.platform : undefined,
      enabled: f.enabled !== false, // 없으면 활성으로 간주
    });
  }
  return out.filter((t) => t.enabled);
}

/**
 * 잘못된/만료된 토큰을 비활성화한다 (`enabled = false`, `updatedAt = 서버시각`).
 *
 * 최소 정리만 한다 — 문서를 지우지 않고 비활성 플래그만 세운다. 완전한 lifecycle
 * (재확인 / 재등록 / GC)은 Phase 4.4 Auth 단계 TODO.
 *
 * @throws {FirestoreError} PATCH non-2xx
 */
export async function disablePushToken(env, tokenId) {
  if (!tokenId) throw new Error('disablePushToken: tokenId required');

  const fields = { enabled: false, updatedAt: new Date() };
  const params = new URLSearchParams();
  for (const key of Object.keys(fields)) params.append('updateMask.fieldPaths', key);
  if (env.FIREBASE_API_KEY) params.set('key', env.FIREBASE_API_KEY);

  const url = `${base(env)}/${PUSH_TOKENS_COLLECTION}/${encodeURIComponent(tokenId)}?${params}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  });
  if (!res.ok) throw new FirestoreError(res.status, await safeText(res));
  return true;
}
