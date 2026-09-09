/**
 * FCM HTTP v1 sender — Phase 4.4 STEP 1.
 *
 *   service account (client_email + private_key, Worker secret)
 *        │  createGoogleAccessToken()   — RS256 JWT → OAuth2 token exchange (Web Crypto)
 *        ▼
 *   Bearer access token (1시간 유효)
 *        │  sendFcmMessage()
 *        ▼
 *   POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
 *
 * ── 왜 HTTP v1 인가 ────────────────────────────────────────────────
 *  legacy FCM server key 방식은 2024 년 폐기됐다. HTTP v1 은 service account
 *  OAuth2 Bearer 토큰을 쓴다. Cloudflare Worker 에는 Node crypto 가 없으므로
 *  **Web Crypto (`crypto.subtle`)** 로 JWT 를 서명한다 — Node 스모크에서도 동일 API.
 *
 * ── secret 취급 ────────────────────────────────────────────────────
 *  `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` 는 **wrangler secret** 으로만 관리한다
 *  (wrangler.toml / repo 에 넣지 않는다). private key · JWT · access token ·
 *  FCM device token 을 **절대 console.log 하지 않는다**. 에러 메시지는 Google 응답
 *  본문 앞 500자만 (거기엔 우리 secret 이 없다).
 *
 * ── 실패 정책 ──────────────────────────────────────────────────────
 *  이 파일의 함수는 실패 시 `FcmError` 를 throw 한다. 그 throw 를 **careStatus
 *  파이프라인까지 전파하지 않는 것**은 notifier.js 의 책임이다 (careStatus write 는
 *  이미 성공했으므로 알림 실패가 Cron 을 무효화하면 안 된다).
 */

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_SEND_HOST = 'https://fcm.googleapis.com/v1';

export class FcmError extends Error {
  /** @param {'config'|'oauth'|'send'} phase */
  constructor(phase, status, detail) {
    super(`FCM ${phase} error${status ? ` ${status}` : ''}: ${detail ?? ''}`.trim());
    this.name = 'FcmError';
    this.phase = phase;
    this.status = status ?? 0;
    this.detail = detail ?? '';
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '(no body)';
  }
}

// ── base64url ───────────────────────────────────────────────────────

function base64UrlFromBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

/** 표준 base64 (PEM 본문) → Uint8Array */
function bytesFromBase64(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * PKCS#8 PEM(`-----BEGIN PRIVATE KEY-----`) → CryptoKey (RSASSA-PKCS1-v1_5 / SHA-256).
 * wrangler secret 에 `\n` 이 리터럴로 저장되는 흔한 실수를 방어적으로 복원한다.
 */
async function importServiceAccountKey(privateKeyPem) {
  const normalized = String(privateKeyPem).replace(/\\n/g, '\n');
  const match = normalized.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/,
  );
  if (!match) {
    throw new FcmError('config', 0, 'FCM_PRIVATE_KEY is not a PKCS#8 PEM');
  }
  const der = bytesFromBase64(match[1].replace(/\s+/g, ''));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ── config ─────────────────────────────────────────────────────────

/**
 * Worker env → FCM 설정. 하나라도 없거나 kill-switch 가 꺼져 있으면 `configured:false`.
 *
 *   FIREBASE_PROJECT_ID         (이미 존재 — 비밀 아님)
 *   FCM_NOTIFICATIONS_ENABLED   "true" 여야 발송 시도 (기본 꺼짐 — 단계적 롤아웃 kill-switch)
 *   FCM_CLIENT_EMAIL            wrangler secret
 *   FCM_PRIVATE_KEY             wrangler secret (PKCS#8 PEM)
 *
 * @returns {{configured:false, reason:string} | {configured:true, projectId:string, clientEmail:string, privateKey:string}}
 */
export function resolveFcmConfig(env = {}) {
  const enabled =
    String(env.FCM_NOTIFICATIONS_ENABLED ?? '').trim().toLowerCase() === 'true';
  if (!enabled) return { configured: false, reason: 'disabled' };

  const projectId = env.FIREBASE_PROJECT_ID;
  const clientEmail = env.FCM_CLIENT_EMAIL;
  const privateKey = env.FCM_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    return { configured: false, reason: 'missing_credentials' };
  }
  return { configured: true, projectId, clientEmail, privateKey };
}

// ── OAuth2 access token ────────────────────────────────────────────

/**
 * service account 로 Google OAuth2 access token 발급 (JWT bearer grant).
 *
 * @param config  resolveFcmConfig() 의 configured 결과
 * @param opts.now        Date — JWT iat/exp 기준
 * @param opts.fetchImpl  기본 globalThis.fetch (테스트에서 mock)
 * @returns {Promise<{ accessToken: string, expiresInSec: number }>}
 * @throws {FcmError} 서명 실패 / 토큰 엔드포인트 non-2xx
 */
export async function createGoogleAccessToken(
  config,
  { now = new Date(), fetchImpl = fetch } = {},
) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600;
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64UrlFromString(
    JSON.stringify({
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat,
      exp,
    }),
  );
  const signingInput = `${header}.${claim}`;

  let signatureBytes;
  try {
    const key = await importServiceAccountKey(config.privateKey);
    const sig = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      new TextEncoder().encode(signingInput),
    );
    signatureBytes = new Uint8Array(sig);
  } catch (err) {
    if (err instanceof FcmError) throw err;
    // err 메시지는 Web Crypto 의 generic DataError 등 — key 재료를 노출하지 않는다.
    throw new FcmError('config', 0, 'failed to sign service-account JWT');
  }

  const assertion = `${signingInput}.${base64UrlFromBytes(signatureBytes)}`;
  const res = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!res.ok) throw new FcmError('oauth', res.status, await safeText(res));

  const json = await res.json().catch(() => ({}));
  if (!json.access_token) throw new FcmError('oauth', res.status, 'no access_token in response');
  return {
    accessToken: json.access_token,
    expiresInSec: typeof json.expires_in === 'number' ? json.expires_in : 3600,
  };
}

// ── FCM message send ───────────────────────────────────────────────

/** UNREGISTERED / 404 / INVALID_ARGUMENT(잘못된 토큰) → 정리 대상. */
function isInvalidTokenError(status, errorCode) {
  return (
    status === 404 ||
    errorCode === 'UNREGISTERED' ||
    errorCode === 'INVALID_ARGUMENT' ||
    errorCode === 'NOT_FOUND'
  );
}

/**
 * FCM HTTP v1 `messages:send` 1건.
 *
 * @param accessToken  createGoogleAccessToken() 결과 (로그 금지)
 * @param projectId    Firebase project id
 * @param message      FCM v1 message 객체 — { token, notification, data, android }
 * @param opts.fetchImpl  기본 globalThis.fetch
 * @returns {Promise<{ ok:boolean, status:number, messageId?:string, errorCode?:string, invalidToken?:boolean }>}
 *          네트워크 예외만 throw. non-2xx 는 분류해서 반환한다.
 */
export async function sendFcmMessage(accessToken, projectId, message, { fetchImpl = fetch } = {}) {
  if (!projectId) throw new FcmError('send', 0, 'projectId required');
  const url = `${FCM_SEND_HOST}/projects/${encodeURIComponent(projectId)}/messages:send`;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const text = await safeText(res);
  if (res.ok) {
    let messageId;
    try {
      messageId = JSON.parse(text).name;
    } catch {
      /* messageId 없어도 성공은 성공 */
    }
    return { ok: true, status: res.status, messageId };
  }

  let errorCode;
  try {
    const j = JSON.parse(text);
    errorCode =
      j?.error?.status ||
      j?.error?.details?.find?.((x) => x.errorCode)?.errorCode ||
      undefined;
  } catch {
    /* 파싱 실패면 errorCode 없음 */
  }
  return {
    ok: false,
    status: res.status,
    errorCode,
    invalidToken: isInvalidTokenError(res.status, errorCode),
  };
}

/**
 * TransitionNotification (순수 정책 결과) + device token → FCM v1 message.
 * data 값은 전부 문자열로 강제한다 (FCM v1 data 는 string map). null/undefined 는 제외.
 *
 * @param {import('../../../src/services/transitionNotification').TransitionNotification} notification
 * @param {string} token  FCM device registration token (로그 금지)
 */
export function buildFcmMessage(notification, token) {
  const data = {};
  for (const [k, v] of Object.entries(notification.data ?? {})) {
    if (v === null || v === undefined) continue;
    data[k] = String(v);
  }
  return {
    token,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data,
    android: {
      priority: notification.priority === 'high' ? 'high' : 'normal',
      notification: { channel_id: 'care-status' },
    },
  };
}
