/**
 * Firestore REST 인증 — Phase 5 STEP 5.3-A.
 *
 *   FCM 과 동일한 service account (FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY, Worker secret)
 *        │  createGoogleAccessToken()  (fcmClient.js 재사용, scope 만 다르게)
 *        ▼
 *   Bearer access token (datastore scope, 1시간 유효 — isolate 내 캐싱, 만료 5분 전 갱신)
 *        │
 *        ▼
 *   firestore.js / firestoreRead.js / careStatusWriter.js / pushTokenStore.js 의
 *   모든 Firestore REST 호출에 `Authorization: Bearer <token>` 헤더로 사용된다.
 *
 * ── 왜 새 secret 을 만들지 않았나 ──────────────────────────────────
 *  FCM 발송에 쓰는 service account 가 이미 이 Firebase 프로젝트 소속이다. 같은
 *  자격증명으로 scope 만 `datastore` 로 바꿔 재사용한다(Phase 5.3-A 결정). 단,
 *  그 service account 의 IAM role 에 Firestore 접근 권한(예: Cloud Datastore User
 *  이상)이 있어야 한다 — 없으면 아래 함수가 401/403 으로 실패한다(무인증 fallback
 *  없음, 아래 "실패 정책" 참고).
 *
 * ── 캐싱 ───────────────────────────────────────────────────────────
 *  Worker isolate 가 살아있는 동안(여러 요청에 걸쳐) 모듈 스코프 변수에 토큰을
 *  캐싱한다. 매 요청마다 새로 발급하지 않는다 — 만료 5분 전에만 재발급한다.
 *  캐시 판단은 항상 실제 벽시계 시각(Date.now())을 쓴다 (opts.now 는 JWT
 *  iat/exp 서명용 테스트 훅일 뿐, 캐시 판단에는 관여하지 않는다).
 *
 * ── 실패 정책 ────────────────────────────────────────────────────────
 *  credential 미설정 / 서명 실패 / 토큰 엔드포인트 실패는 전부 `FirestoreAuthError`
 *  로 throw 한다. **무인증 상태로 Firestore 요청을 계속 진행하지 않는다** — 호출자
 *  (firestore.js 등)는 이 함수가 reject 되면 그 즉시 실패로 처리해야 한다.
 *
 * ── secret 취급 ────────────────────────────────────────────────────
 *  private key / JWT / access token 을 절대 로그에 출력하지 않는다 (fcmClient.js
 *  와 동일 원칙). 에러 메시지는 Google 응답 본문 앞 500자만 포함할 수 있다.
 */

import { createGoogleAccessToken } from './fcmClient.js';

const DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
/** 실제 만료 시각보다 이만큼 일찍 재발급한다 (Cron/요청 도중 만료되는 것을 방지). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class FirestoreAuthError extends Error {
  constructor(detail) {
    super(`Firestore auth error: ${detail}`);
    this.name = 'FirestoreAuthError';
  }
}

/**
 * FCM 과 동일한 secret(FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY) 을 Firestore 인증에도 쓴다.
 * 새 FIRESTORE_CLIENT_EMAIL / FIRESTORE_PRIVATE_KEY secret 은 만들지 않는다(Phase 5.3-A).
 *
 * @returns {{configured:false, reason:string} | {configured:true, projectId:string, clientEmail:string, privateKey:string}}
 */
export function resolveFirestoreAuthConfig(env = {}) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FCM_CLIENT_EMAIL;
  const privateKey = env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    return { configured: false, reason: 'missing_credentials' };
  }
  return { configured: true, projectId, clientEmail, privateKey };
}

// Worker isolate 스코프 캐시. 요청 간 격리로 항상 재사용되는 건 아니지만, 같은
// isolate 가 여러 요청을 처리하는 동안(warm) 은 재사용된다.
let cachedToken = null;
let cachedExpiryMs = 0;

/** 테스트 전용 — 모듈 스코프 캐시를 초기화한다. 프로덕션 코드에서는 호출하지 않는다. */
export function _resetFirestoreAccessTokenCacheForTest() {
  cachedToken = null;
  cachedExpiryMs = 0;
}

/**
 * Firestore REST 호출용 OAuth2 access token. 캐시가 유효하면 네트워크 호출 없이 반환한다.
 *
 * @param env  Worker env (FIREBASE_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY)
 * @param opts.now        Date — JWT iat/exp 서명용 (테스트 훅). 캐시 판단에는 안 쓴다.
 * @param opts.fetchImpl  기본 globalThis.fetch (테스트 mock)
 * @returns {Promise<string>} access token
 * @throws {FirestoreAuthError} credential 미설정 / 서명 실패 / 토큰 발급 실패 시.
 *   호출자는 이 경우 Firestore 요청을 진행하면 안 된다.
 */
export async function getFirestoreAccessToken(env, { now = new Date(), fetchImpl = fetch } = {}) {
  const nowMs = Date.now();
  if (cachedToken && nowMs < cachedExpiryMs - REFRESH_MARGIN_MS) {
    return cachedToken;
  }

  const config = resolveFirestoreAuthConfig(env);
  if (!config.configured) {
    throw new FirestoreAuthError(`credentials not configured (${config.reason})`);
  }

  let accessToken;
  let expiresInSec;
  try {
    ({ accessToken, expiresInSec } = await createGoogleAccessToken(config, {
      now,
      fetchImpl,
      scope: DATASTORE_SCOPE,
    }));
  } catch (err) {
    // err 는 FcmError(phase:'config'|'oauth') — 메시지에 secret 없음 (fcmClient.js 계약).
    throw new FirestoreAuthError(err instanceof Error ? err.message : String(err));
  }

  cachedToken = accessToken;
  cachedExpiryMs = nowMs + expiresInSec * 1000;
  return cachedToken;
}
