/**
 * Phase 4.4 STEP 1 — FCM 전환 알림 파이프라인 스모크.
 *
 * 실행:  node scripts/phase44-notification-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상 (전부 deterministic — 실제 FCM/네트워크 호출 없음, fetch mock):
 *   A. deriveTransitionNotifications()  — 순수 정책 (src/services/transitionNotification.ts)
 *        · initial / reason-only / 같은 상태 → 알림 없음
 *        · NORMAL→CHECK, CHECK→NORMAL, →EMERGENCY, online→offline, offline→online
 *        · 두 축 동시 전환 → 알림 1개 (결합 or 우선순위), 절대 2개 아님
 *   B. buildFcmMessage()  — data 전부 문자열, null/undefined 제외, android priority/channel
 *   C. fcmClient  — resolveFcmConfig / createGoogleAccessToken(실제 RS256 서명 + JWT 검증) /
 *        sendFcmMessage(성공 / HTTP 실패 / invalid token 분류) / secret 미노출
 *   D. pushTokenStore  — queryGuardianPushTokens(fieldFilter + enabled 필터) / disablePushToken(PATCH mask)
 *   E. notifier  — 절대 throw 안 함 / 설정 없으면 skip / 토큰 없으면 skip / 정상 전송 /
 *        oauth 실패 → skip / invalid token → 정리 / 로그에 토큰 값 없음
 *   F. scheduled 통합  — changed && !isInitial 일 때만 notify / WRITE 성공 후 / notify 실패가 Cron 실패 아님
 *   G. pushRegistration  — buildPushTokenDoc / pushTokenDocId (순수)
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  deriveTransitionNotifications,
} from '../src/services/transitionNotification.ts';
import {
  resolveFcmConfig,
  createGoogleAccessToken,
  sendFcmMessage,
  buildFcmMessage,
  FcmError,
} from '../server/cloudflare-worker/src/fcmClient.js';
import {
  queryGuardianPushTokens,
  disablePushToken,
  PUSH_TOKENS_COLLECTION,
} from '../server/cloudflare-worker/src/pushTokenStore.js';
import { notifyCareStatusTransition } from '../server/cloudflare-worker/src/notifier.js';
import { runScheduledCareStatus } from '../server/cloudflare-worker/src/scheduled.js';
import { toFirestoreFields, fromFirestoreFields } from '../server/cloudflare-worker/src/firestore.js';
import {
  buildPushTokenDoc,
  pushTokenDocId,
} from '../src/services/pushTokenDoc.ts';

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
const NOW = new Date('2026-09-10T00:00:00.000Z');

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

/** deriveCareStatusTransition 결과 모양을 만든다. person/device = [from,to] | null */
function T({ person = null, device = null, isInitial = false } = {}) {
  const personTransition = person ? { from: person[0], to: person[1] } : null;
  const deviceTransition = device ? { from: device[0], to: device[1] } : null;
  return {
    isInitial,
    personTransition,
    deviceTransition,
    changed: !isInitial && Boolean(personTransition || deviceTransition),
  };
}

const CTX = { careRecipientId: CARE_ID };

// ═══════════════════════════════════════════════════════════════════════
//  A. deriveTransitionNotifications — 순수 정책
// ═══════════════════════════════════════════════════════════════════════

check('A1. initial NORMAL/CHECK/EMERGENCY → 알림 없음', () => {
  assert.deepEqual(deriveTransitionNotifications(T({ isInitial: true }), CTX), []);
  // 최초 스냅샷은 어떤 상태든 baseline seed — 전환 아님
  assert.deepEqual(
    deriveTransitionNotifications(
      { isInitial: true, personTransition: null, deviceTransition: null, changed: false },
      CTX,
    ),
    [],
  );
});

check('A2. changed=false (같은 상태 / reason-only) → 알림 없음', () => {
  assert.deepEqual(deriveTransitionNotifications(T({}), CTX), []);
  assert.deepEqual(
    deriveTransitionNotifications(
      { isInitial: false, personTransition: null, deviceTransition: null, changed: false },
      CTX,
    ),
    [],
  );
});

check('A3. NORMAL→CHECK → person_check 1개 (high)', () => {
  const n = deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), CTX);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'person_check');
  assert.equal(n[0].priority, 'high');
  assert.equal(n[0].data.personFrom, 'NORMAL');
  assert.equal(n[0].data.personTo, 'CHECK');
  assert.ok(!/쓰러|낙상|위험|생명/.test(n[0].title + n[0].body), '진단/확정 문구 금지');
});

check('A4. CHECK→NORMAL → person_recovery 1개 (normal priority)', () => {
  const n = deriveTransitionNotifications(T({ person: ['CHECK', 'NORMAL'] }), CTX);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'person_recovery');
  assert.equal(n[0].priority, 'normal');
});

check('A5. NORMAL→EMERGENCY / CHECK→EMERGENCY → person_emergency', () => {
  for (const from of ['NORMAL', 'CHECK']) {
    const n = deriveTransitionNotifications(T({ person: [from, 'EMERGENCY'] }), CTX);
    assert.equal(n.length, 1);
    assert.equal(n[0].kind, 'person_emergency');
    assert.equal(n[0].priority, 'high');
  }
});

check('A6. EMERGENCY→NORMAL → recovery, EMERGENCY→CHECK → check', () => {
  assert.equal(
    deriveTransitionNotifications(T({ person: ['EMERGENCY', 'NORMAL'] }), CTX)[0].kind,
    'person_recovery',
  );
  assert.equal(
    deriveTransitionNotifications(T({ person: ['EMERGENCY', 'CHECK'] }), CTX)[0].kind,
    'person_check',
  );
});

check('A7. online→offline → device_offline (high)', () => {
  const n = deriveTransitionNotifications(T({ device: ['online', 'offline'] }), CTX);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'device_offline');
  assert.equal(n[0].priority, 'high');
  assert.equal(n[0].data.deviceFrom, 'online');
  assert.equal(n[0].data.deviceTo, 'offline');
});

check('A8. offline→online → device_recovery (normal)', () => {
  const n = deriveTransitionNotifications(T({ device: ['offline', 'online'] }), CTX);
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'device_recovery');
  assert.equal(n[0].priority, 'normal');
});

check('A9. device → unknown 은 알림 아님', () => {
  assert.deepEqual(deriveTransitionNotifications(T({ device: ['online', 'unknown'] }), CTX), []);
});

check('A10. 두 축 동시: NORMAL→CHECK + online→offline → 결합 알림 1개', () => {
  const n = deriveTransitionNotifications(
    T({ person: ['NORMAL', 'CHECK'], device: ['online', 'offline'] }),
    CTX,
  );
  assert.equal(n.length, 1, '절대 2개 아님');
  assert.equal(n[0].kind, 'person_check_device_offline');
  assert.equal(n[0].data.personTo, 'CHECK');
  assert.equal(n[0].data.deviceTo, 'offline');
});

check('A11. 두 축 동시: EMERGENCY + online→offline → person_emergency 하나만', () => {
  const n = deriveTransitionNotifications(
    T({ person: ['NORMAL', 'EMERGENCY'], device: ['online', 'offline'] }),
    CTX,
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'person_emergency');
});

check('A12. 두 축 동시: CHECK→NORMAL(복구) + online→offline → device_offline 우선', () => {
  const n = deriveTransitionNotifications(
    T({ person: ['CHECK', 'NORMAL'], device: ['online', 'offline'] }),
    CTX,
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'device_offline');
});

check('A13. 두 축 동시: NORMAL→CHECK + offline→online → person_check 우선', () => {
  const n = deriveTransitionNotifications(
    T({ person: ['NORMAL', 'CHECK'], device: ['offline', 'online'] }),
    CTX,
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].kind, 'person_check');
});

check('A14. 반복 tick — 2번째 tick 은 changed=false → 알림 없음 (중복 방지)', () => {
  // tick1: NORMAL→CHECK
  assert.equal(deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), CTX).length, 1);
  // tick2: CHECK 유지 (전환 없음)
  assert.equal(deriveTransitionNotifications(T({}), CTX).length, 0);
  // tick3: offline 유지
  assert.equal(deriveTransitionNotifications(T({}), CTX).length, 0);
});

check('A15. 항상 배열 길이 ≤ 1 (여러 조합)', () => {
  const combos = [
    T({ person: ['NORMAL', 'CHECK'] }),
    T({ person: ['CHECK', 'NORMAL'], device: ['online', 'offline'] }),
    T({ person: ['NORMAL', 'EMERGENCY'], device: ['offline', 'online'] }),
    T({ device: ['online', 'offline'] }),
    T({ person: ['EMERGENCY', 'NORMAL'], device: ['offline', 'online'] }),
  ];
  for (const c of combos) assert.ok(deriveTransitionNotifications(c, CTX).length <= 1);
});

check('A16. ctx.careRecipientId 없으면 throw', () => {
  assert.throws(() => deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), {}), /careRecipientId/);
});

check('A17. data 페이로드 — 전환 안 된 축의 from/to 는 없음', () => {
  const n = deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), CTX)[0];
  assert.equal(n.data.type, 'CARE_STATUS_TRANSITION');
  assert.equal(n.data.careRecipientId, CARE_ID);
  assert.equal(n.data.deviceFrom, undefined);
  assert.equal(n.data.deviceTo, undefined);
});

// ═══════════════════════════════════════════════════════════════════════
//  B. buildFcmMessage
// ═══════════════════════════════════════════════════════════════════════

check('B1. buildFcmMessage — data 전부 문자열, notification title/body, token', () => {
  const [n] = deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), CTX);
  const msg = buildFcmMessage(n, 'TOKEN_ABC');
  assert.equal(msg.token, 'TOKEN_ABC');
  assert.equal(msg.notification.title, n.title);
  assert.equal(msg.notification.body, n.body);
  for (const v of Object.values(msg.data)) assert.equal(typeof v, 'string');
  assert.equal(msg.data.type, 'CARE_STATUS_TRANSITION');
  assert.ok(!('deviceFrom' in msg.data), 'undefined 키는 제외');
});

check('B2. buildFcmMessage — android priority 매핑 + channel_id', () => {
  const [high] = deriveTransitionNotifications(T({ person: ['NORMAL', 'CHECK'] }), CTX);
  const [low] = deriveTransitionNotifications(T({ person: ['CHECK', 'NORMAL'] }), CTX);
  assert.equal(buildFcmMessage(high, 't').android.priority, 'high');
  assert.equal(buildFcmMessage(low, 't').android.priority, 'normal');
  assert.equal(buildFcmMessage(high, 't').android.notification.channel_id, 'care-status');
});

// ═══════════════════════════════════════════════════════════════════════
//  C. fcmClient
// ═══════════════════════════════════════════════════════════════════════

check('C1. resolveFcmConfig — kill-switch off → disabled', () => {
  const c = resolveFcmConfig({ FIREBASE_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e', FCM_PRIVATE_KEY: 'k' });
  assert.equal(c.configured, false);
  assert.equal(c.reason, 'disabled');
});

check('C2. resolveFcmConfig — on 이지만 secret 없음 → missing_credentials', () => {
  const c = resolveFcmConfig({ FCM_NOTIFICATIONS_ENABLED: 'true', FIREBASE_PROJECT_ID: 'p' });
  assert.equal(c.configured, false);
  assert.equal(c.reason, 'missing_credentials');
});

check('C3. resolveFcmConfig — 전부 있으면 configured', () => {
  const c = resolveFcmConfig({
    FCM_NOTIFICATIONS_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'byeolileopji',
    FCM_CLIENT_EMAIL: 'sa@byeolileopji.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: 'x',
  });
  assert.equal(c.configured, true);
  assert.equal(c.projectId, 'byeolileopji');
});

// 실제 RSA 키로 JWT 서명 → mock oauth 엔드포인트에서 서명 검증
const { publicKey: TEST_PUB, privateKey: TEST_PRIV } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const FCM_CONFIG = {
  configured: true,
  projectId: 'byeolileopji',
  clientEmail: 'sa@byeolileopji.iam.gserviceaccount.com',
  privateKey: TEST_PRIV,
};

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

check('C4. createGoogleAccessToken — 실제 RS256 서명 + 올바른 claim, 서명 검증 통과', async () => {
  let capturedAssertion;
  const fetchImpl = async (url, opts) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(opts.body);
    assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    capturedAssertion = body.get('assertion');
    return new Response(JSON.stringify({ access_token: 'ya29.TESTTOKEN', expires_in: 3599 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const { accessToken, expiresInSec } = await createGoogleAccessToken(FCM_CONFIG, {
    now: NOW,
    fetchImpl,
  });
  assert.equal(accessToken, 'ya29.TESTTOKEN');
  assert.equal(expiresInSec, 3599);

  const [h, p, sig] = capturedAssertion.split('.');
  const header = JSON.parse(b64urlToBuf(h).toString());
  const claim = JSON.parse(b64urlToBuf(p).toString());
  assert.equal(header.alg, 'RS256');
  assert.equal(claim.iss, FCM_CONFIG.clientEmail);
  assert.equal(claim.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claim.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claim.iat, Math.floor(NOW.getTime() / 1000));
  assert.equal(claim.exp, claim.iat + 3600);

  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    TEST_PUB,
    b64urlToBuf(sig),
  );
  assert.ok(ok, 'JWT 서명이 service account 공개키로 검증돼야 한다');
});

check('C5. createGoogleAccessToken — oauth non-2xx → FcmError(oauth), 응답본문만 detail', async () => {
  const fetchImpl = async () =>
    new Response('{"error":"invalid_grant"}', { status: 400 });
  await assert.rejects(
    () => createGoogleAccessToken(FCM_CONFIG, { now: NOW, fetchImpl }),
    (e) => {
      assert.ok(e instanceof FcmError);
      assert.equal(e.phase, 'oauth');
      assert.equal(e.status, 400);
      assert.ok(!String(e.message).includes('PRIVATE KEY'), 'private key 미노출');
      return true;
    },
  );
});

check('C6. createGoogleAccessToken — 잘못된 PEM → FcmError(config), 키 재료 미노출', async () => {
  await assert.rejects(
    () =>
      createGoogleAccessToken(
        { ...FCM_CONFIG, privateKey: 'not-a-pem' },
        { now: NOW, fetchImpl: async () => new Response('{}', { status: 200 }) },
      ),
    (e) => e instanceof FcmError && e.phase === 'config',
  );
});

check('C7. sendFcmMessage — 200 → { ok:true, messageId }', async () => {
  const fetchImpl = async (url, opts) => {
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/byeolileopji/messages:send');
    assert.equal(opts.headers.authorization, 'Bearer ya29.X');
    return new Response(JSON.stringify({ name: 'projects/byeolileopji/messages/0:123' }), {
      status: 200,
    });
  };
  const r = await sendFcmMessage('ya29.X', 'byeolileopji', { token: 't' }, { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.messageId, 'projects/byeolileopji/messages/0:123');
});

check('C8. sendFcmMessage — 401 → { ok:false, invalidToken:false }', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { status: 'UNAUTHENTICATED' } }), { status: 401 });
  const r = await sendFcmMessage('bad', 'p', { token: 't' }, { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.invalidToken, false);
});

check('C9. sendFcmMessage — UNREGISTERED / 404 → invalidToken:true', async () => {
  const unreg = async () =>
    new Response(JSON.stringify({ error: { status: 'UNREGISTERED' } }), { status: 404 });
  const r = await sendFcmMessage('x', 'p', { token: 't' }, { fetchImpl: unreg });
  assert.equal(r.ok, false);
  assert.equal(r.invalidToken, true);
});

// ═══════════════════════════════════════════════════════════════════════
//  D. pushTokenStore
// ═══════════════════════════════════════════════════════════════════════

function mockFetch(router) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body && typeof opts.body === 'string' && opts.body.startsWith('{')
      ? JSON.parse(opts.body)
      : opts.body;
    calls.push({ u, method, body });
    const res = await router({ u, method, body, opts });
    if (res) return res;
    // Phase 5.3-A — router 가 처리하지 않은 OAuth 토큰 요청은 기본적으로 성공시킨다.
    // Firestore REST 헬퍼가 이제 매 호출 전 OAuth 토큰을 먼저 발급받기 때문에, oauth
    // 자체를 테스트 대상으로 삼지 않는 라우터(D1/D3 등)가 일일이 처리하지 않아도 된다.
    // (oauth 자체를 실패시키고 싶은 라우터는 이 URL 을 직접 처리해 null 이 아닌 값을 반환하면 된다.)
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.OK', expires_in: 3599 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(`UNEXPECTED ${method} ${u}`, { status: 599 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

// Phase 5.3-A — Firestore REST 도 이제 OAuth 인증이 필요하다. 위에서 이미 생성한
// FCM 용 실제 RSA 키(TEST_PRIV/FCM_CONFIG, C4 테스트 부근)를 그대로 재사용한다.
const ENV = {
  FIREBASE_PROJECT_ID: 'byeolileopji',
  CARE_RECIPIENT_ID: CARE_ID,
  DEVICE_ID,
  FCM_CLIENT_EMAIL: FCM_CONFIG.clientEmail,
  FCM_PRIVATE_KEY: TEST_PRIV,
};

function pushTokenRows(rows) {
  return rows.map((r) => ({
    document: {
      name: `projects/p/databases/(default)/documents/${PUSH_TOKENS_COLLECTION}/${r.id}`,
      fields: toFirestoreFields({
        token: r.token,
        platform: r.platform ?? 'android',
        careRecipientId: CARE_ID,
        enabled: r.enabled ?? true,
      }),
    },
  }));
}

check('D1. queryGuardianPushTokens — careRecipientId fieldFilter + enabled=false 제외', async () => {
  const m = mockFetch(async ({ u, method, body }) => {
    if (u.includes(':runQuery') && method === 'POST') {
      const ff = body.structuredQuery.where.fieldFilter;
      assert.equal(ff.field.fieldPath, 'careRecipientId');
      assert.equal(ff.op, 'EQUAL');
      assert.equal(ff.value.stringValue, CARE_ID);
      assert.equal(body.structuredQuery.from[0].collectionId, PUSH_TOKENS_COLLECTION);
      return new Response(
        JSON.stringify(
          pushTokenRows([
            { id: 'android-1', token: 'TOK1', enabled: true },
            { id: 'android-2', token: 'TOK2', enabled: false },
            { id: 'android-3', token: '', enabled: true },
          ]).concat([{ readTime: NOW.toISOString() }]),
        ),
        { status: 200 },
      );
    }
    return null;
  });
  try {
    const tokens = await queryGuardianPushTokens(ENV, CARE_ID);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].id, 'android-1');
    assert.equal(tokens[0].token, 'TOK1');
  } finally {
    m.restore();
  }
});

check('D2. queryGuardianPushTokens — runQuery 500 → FirestoreError', async () => {
  const m = mockFetch(async ({ u }) => {
    // OAuth 토큰 발급은 성공시키고, Firestore runQuery 자체만 실패시킨다 (Phase 5.3-A).
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.OK', expires_in: 3599 }), {
        status: 200,
      });
    }
    return new Response('{"error":{}}', { status: 500 });
  });
  try {
    await assert.rejects(() => queryGuardianPushTokens(ENV, CARE_ID), (e) => e.status === 500);
  } finally {
    m.restore();
  }
});

check('D3. disablePushToken — PATCH enabled+updatedAt, updateMask 정확', async () => {
  const m = mockFetch(async ({ u, method, body }) => {
    if (u.includes(`/${PUSH_TOKENS_COLLECTION}/android-1`) && method === 'PATCH') {
      assert.ok(u.includes('updateMask.fieldPaths=enabled'));
      assert.ok(u.includes('updateMask.fieldPaths=updatedAt'));
      const f = fromFirestoreFields(body.fields);
      assert.equal(f.enabled, false);
      return new Response('{}', { status: 200 });
    }
    return null;
  });
  try {
    assert.equal(await disablePushToken(ENV, 'android-1'), true);
  } finally {
    m.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  E. notifier — 절대 throw 안 함
// ═══════════════════════════════════════════════════════════════════════

const silent = { log() {}, error() {} };

function captureLogger() {
  const lines = [];
  return {
    lines,
    log: (m) => lines.push(String(m)),
    error: (m) => lines.push(String(m)),
  };
}

/** 정상 경로 fetch router — oauth OK + FCM send 결과를 sendResult 로 제어 */
function notifierRouter({ tokens = [{ id: 'android-1', token: 'REALTOKEN' }], oauthStatus = 200, sendStatus = 200, sendBody } = {}) {
  return async ({ u, method }) => {
    if (u.includes('oauth2.googleapis.com/token')) {
      if (oauthStatus !== 200) return new Response('{"error":"x"}', { status: oauthStatus });
      return new Response(JSON.stringify({ access_token: 'ya29.OK', expires_in: 3599 }), { status: 200 });
    }
    if (u.includes(':runQuery') && method === 'POST') {
      return new Response(JSON.stringify(pushTokenRows(tokens.map((t) => ({ ...t, enabled: true })))), {
        status: 200,
      });
    }
    if (u.includes('fcm.googleapis.com') && u.includes('messages:send')) {
      if (sendStatus === 200) {
        return new Response(JSON.stringify({ name: 'projects/byeolileopji/messages/x' }), { status: 200 });
      }
      return new Response(sendBody ?? JSON.stringify({ error: { status: 'INTERNAL' } }), { status: sendStatus });
    }
    if (u.includes(`/${PUSH_TOKENS_COLLECTION}/`) && method === 'PATCH') {
      return new Response('{}', { status: 200 });
    }
    return null;
  };
}

const ENABLED_ENV = {
  ...ENV,
  FCM_NOTIFICATIONS_ENABLED: 'true',
  FCM_CLIENT_EMAIL: FCM_CONFIG.clientEmail,
  FCM_PRIVATE_KEY: TEST_PRIV,
};

check('E1. notifier — no_policy_match (reason-only) → skip, throw 안 함', async () => {
  const r = await notifyCareStatusTransition(
    ENABLED_ENV,
    { careRecipientId: CARE_ID, transition: T({}) },
    { now: NOW, logger: silent },
  );
  assert.equal(r.skipped, 'no_policy_match');
  assert.equal(r.sent, 0);
});

check('E2. notifier — FCM 미설정(kill-switch off) → skip fcm_disabled', async () => {
  const r = await notifyCareStatusTransition(
    ENV, // FCM_NOTIFICATIONS_ENABLED 없음
    { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
    { now: NOW, logger: silent },
  );
  assert.equal(r.skipped, 'fcm_disabled');
});

check('E3. notifier — 토큰 없음 → skip no_tokens', async () => {
  const m = mockFetch(notifierRouter({ tokens: [] }));
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: silent },
    );
    assert.equal(r.skipped, 'no_tokens');
  } finally {
    m.restore();
  }
});

check('E4. notifier — 정상 전송 → sent=1, 로그/결과에 토큰 값 없음', async () => {
  const m = mockFetch(notifierRouter({ tokens: [{ id: 'android-1', token: 'SECRET_DEVICE_TOKEN' }] }));
  const lg = captureLogger();
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: lg },
    );
    assert.equal(r.decided, 1);
    assert.equal(r.sent, 1);
    assert.equal(r.failed, 0);
    assert.equal(r.skipped, null);
    assert.ok(!JSON.stringify(r).includes('SECRET_DEVICE_TOKEN'), '결과에 토큰 값 없음');
    assert.ok(!lg.lines.join('\n').includes('SECRET_DEVICE_TOKEN'), '로그에 토큰 값 없음');
  } finally {
    m.restore();
  }
});

check('E5. notifier — oauth 실패 → skip oauth_failed, throw 안 함, private key 미노출', async () => {
  const m = mockFetch(notifierRouter({ oauthStatus: 400 }));
  const lg = captureLogger();
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: lg },
    );
    assert.equal(r.skipped, 'oauth_failed');
    assert.ok(!lg.lines.join('\n').includes('PRIVATE KEY'));
  } finally {
    m.restore();
  }
});

check('E6. notifier — FCM 500 → failed=1, skip 아님, throw 안 함', async () => {
  const m = mockFetch(notifierRouter({ sendStatus: 500 }));
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: silent },
    );
    assert.equal(r.failed, 1);
    assert.equal(r.sent, 0);
  } finally {
    m.restore();
  }
});

check('E7. notifier — invalid token(UNREGISTERED) → disablePushToken 호출, invalidCleaned=1', async () => {
  let patched = false;
  const m = mockFetch(async (ctx) => {
    if (ctx.u.includes(`/${PUSH_TOKENS_COLLECTION}/`) && ctx.method === 'PATCH') {
      patched = true;
      return new Response('{}', { status: 200 });
    }
    return notifierRouter({
      sendStatus: 404,
      sendBody: JSON.stringify({ error: { status: 'UNREGISTERED' } }),
    })(ctx);
  });
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: silent },
    );
    assert.equal(r.failed, 1);
    assert.equal(r.invalidCleaned, 1);
    assert.ok(patched, 'disablePushToken PATCH 가 호출돼야 함');
  } finally {
    m.restore();
  }
});

check('E8. notifier — 예상 못한 예외도 삼킨다 (skip:error, resolve)', async () => {
  const m = mockFetch(async () => {
    throw new Error('network boom');
  });
  try {
    const r = await notifyCareStatusTransition(
      ENABLED_ENV,
      { careRecipientId: CARE_ID, transition: T({ person: ['NORMAL', 'CHECK'] }) },
      { now: NOW, logger: silent },
    );
    // queryGuardianPushTokens 가 throw → 바깥 catch → skip:error
    assert.equal(r.skipped, 'error');
  } finally {
    m.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  F. scheduled 통합
// ═══════════════════════════════════════════════════════════════════════

/** careStatus 파이프라인 + notifier 를 함께 mock (transition-smoke 패턴 + FCM 라우팅) */
function schedulerMock({
  careStatusState = null,
  events = [],
  device = {},
  writeStatus = 200,
  fcm = {},
} = {}) {
  let current = careStatusState;
  const calls = [];
  const original = globalThis.fetch;
  const send = notifierRouter(fcm);

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body && String(opts.body).startsWith('{') ? JSON.parse(opts.body) : opts.body;
    calls.push({ u, method, body });

    const isCareStatusUrl = u.includes('/careStatus/');
    if (isCareStatusUrl && method === 'GET') {
      if (current == null) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ name: u.split('?')[0], fields: current.fields }), { status: 200 });
    }
    if (isCareStatusUrl && method === 'PATCH') {
      if (writeStatus >= 200 && writeStatus < 300) {
        current = { fields: body.fields };
        return new Response(JSON.stringify({ fields: body.fields }), { status: writeStatus });
      }
      return new Response('{"error":{}}', { status: writeStatus });
    }
    if (u.includes(':runQuery') && method === 'POST') {
      const coll = body?.structuredQuery?.from?.[0]?.collectionId;
      if (coll === PUSH_TOKENS_COLLECTION) return send({ u, method, body });
      // events
      return new Response(
        JSON.stringify(
          events.map((e) => ({
            document: {
              name: `x/${Math.random()}`,
              fields: toFirestoreFields({ careRecipientId: CARE_ID, eventType: e.eventType, occurredAt: new Date(e.occurredAt) }),
            },
          })),
        ),
        { status: 200 },
      );
    }
    if (u.includes('/devices/') && method === 'GET') {
      return new Response(
        JSON.stringify({
          name: 'x',
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            enabled: true,
            ...(device.lastHeartbeatAt ? { lastHeartbeatAt: new Date(device.lastHeartbeatAt) } : {}),
          }),
        }),
        { status: 200 },
      );
    }
    if (u.includes('oauth2.googleapis.com') || u.includes('fcm.googleapis.com') || (u.includes('/pushTokens/') )) {
      return send({ u, method, body });
    }
    return new Response(`UNEXPECTED ${method} ${u}`, { status: 599 });
  };

  return {
    calls,
    fcmSendCalls: () => calls.filter((c) => c.u.includes('messages:send')),
    restore() {
      globalThis.fetch = original;
    },
  };
}

const iso = (min) => new Date(NOW.getTime() - min * 60_000).toISOString();

function careStatusFields(o) {
  return toFirestoreFields({
    careRecipientId: CARE_ID,
    schemaVersion: 1,
    status: o.status,
    reason: o.reason ?? 'recent_activity',
    systemHealth: 'ok',
    deviceHealth: o.deviceHealth,
    deviceHealthReason: 'heartbeat_fresh',
    computedAt: new Date(iso(10)),
  });
}

check('F1. scheduled — 초기 baseline(isInitial) EMERGENCY → notify 호출 안 함', async () => {
  const m = schedulerMock({
    careStatusState: null,
    events: [{ eventType: 'sos_triggered', occurredAt: iso(30) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const out = await runScheduledCareStatus(ENABLED_ENV, { now: NOW, logger: silent });
    assert.equal(out.results[0].status, 'EMERGENCY');
    assert.equal(out.results[0].isInitial, true);
    assert.equal(out.results[0].notify, null, 'isInitial 이면 notify 없음');
    assert.equal(m.fcmSendCalls().length, 0);
  } finally {
    m.restore();
  }
});

check('F2. scheduled — changed=false (NORMAL 유지) → notify 호출 안 함', async () => {
  const m = schedulerMock({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const out = await runScheduledCareStatus(ENABLED_ENV, { now: NOW, logger: silent });
    assert.equal(out.results[0].changed, false);
    assert.equal(out.results[0].notify, null);
    assert.equal(m.fcmSendCalls().length, 0);
  } finally {
    m.restore();
  }
});

check('F3. scheduled — NORMAL→CHECK 전환 → WRITE 후 notify, FCM send 1회', async () => {
  const m = schedulerMock({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const out = await runScheduledCareStatus(ENABLED_ENV, { now: NOW, logger: silent });
    assert.equal(out.results[0].changed, true);
    assert.deepEqual(out.results[0].personTransition, { from: 'NORMAL', to: 'CHECK' });
    assert.equal(out.results[0].notify.sent, 1);
    // WRITE(PATCH careStatus) 가 FCM send 보다 먼저 호출됐는지 순서 확인
    const idxWrite = m.calls.findIndex((c) => c.u.includes('/careStatus/') && c.method === 'PATCH');
    const idxSend = m.calls.findIndex((c) => c.u.includes('messages:send'));
    assert.ok(idxWrite >= 0 && idxSend >= 0 && idxWrite < idxSend, 'WRITE 가 notify 보다 먼저');
  } finally {
    m.restore();
  }
});

check('F4. scheduled — notify 내부 FCM 실패해도 runScheduledCareStatus 는 성공', async () => {
  const m = schedulerMock({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
    fcm: { sendStatus: 500 },
  });
  try {
    const out = await runScheduledCareStatus(ENABLED_ENV, { now: NOW, logger: silent });
    assert.equal(out.results[0].changed, true);
    assert.equal(out.results[0].notify.failed, 1);
    assert.equal(out.results[0].notify.sent, 0);
    // careStatus 문서는 갱신됨 (write 는 성공)
    assert.equal(m.calls.some((c) => c.u.includes('/careStatus/') && c.method === 'PATCH'), true);
  } finally {
    m.restore();
  }
});

check('F5. scheduled — snapshot WRITE 실패 → throw (notify 도달 안 함)', async () => {
  const m = schedulerMock({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
    writeStatus: 500,
  });
  const savedErr = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => runScheduledCareStatus(ENABLED_ENV, { now: NOW, logger: silent }));
    assert.equal(m.fcmSendCalls().length, 0, 'WRITE 실패면 notify 안 함');
  } finally {
    console.error = savedErr;
    m.restore();
  }
});

check('F6. scheduled — FCM 미설정 env 에서도 전환 시 정상 동작 (notify skip)', async () => {
  const m = schedulerMock({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const out = await runScheduledCareStatus(ENV, { now: NOW, logger: silent }); // FCM off
    assert.equal(out.results[0].changed, true);
    assert.equal(out.results[0].notify.skipped, 'fcm_disabled');
    assert.equal(m.fcmSendCalls().length, 0);
  } finally {
    m.restore();
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  G. pushRegistration 순수 헬퍼
// ═══════════════════════════════════════════════════════════════════════

const GUARDIAN_UID = 'guardian-uid-1';

check('G1. buildPushTokenDoc — 정규화 + enabled:true (guardianUid 포함, Phase 5.2)', () => {
  const d = buildPushTokenDoc({
    token: '  TOK  ',
    platform: 'ANDROID',
    guardianUid: GUARDIAN_UID,
    careRecipientId: CARE_ID,
  });
  assert.deepEqual(d, {
    token: 'TOK',
    platform: 'android',
    guardianUid: GUARDIAN_UID,
    careRecipientId: CARE_ID,
    enabled: true,
  });
});

check('G2. buildPushTokenDoc — 알 수 없는 platform → unknown', () => {
  assert.equal(
    buildPushTokenDoc({
      token: 't',
      platform: 'blackberry',
      guardianUid: GUARDIAN_UID,
      careRecipientId: CARE_ID,
    }).platform,
    'unknown',
  );
});

check('G3. buildPushTokenDoc — token / guardianUid / careRecipientId 없으면 throw', () => {
  assert.throws(
    () => buildPushTokenDoc({ token: '', platform: 'android', guardianUid: GUARDIAN_UID, careRecipientId: CARE_ID }),
    /token/,
  );
  assert.throws(
    () => buildPushTokenDoc({ token: 't', platform: 'android', guardianUid: '', careRecipientId: CARE_ID }),
    /guardianUid/,
  );
  assert.throws(
    () => buildPushTokenDoc({ token: 't', platform: 'android', guardianUid: GUARDIAN_UID, careRecipientId: '' }),
    /careRecipientId/,
  );
});

check('G4. pushTokenDocId — 결정적, 같은 토큰 → 같은 id, 다른 토큰 → 다른 id', () => {
  assert.equal(pushTokenDocId('android', 'abc'), pushTokenDocId('android', 'abc'));
  assert.notEqual(pushTokenDocId('android', 'abc'), pushTokenDocId('android', 'abd'));
  assert.match(pushTokenDocId('android', 'abc'), /^android-[0-9a-f]{8}$/);
});

// ── wrangler.toml / .dev.vars.example 정적 확인 ──────────────────────

check('H1. wrangler.toml — FCM_NOTIFICATIONS_ENABLED="true" (실기기 E2E 검증 완료, 운영 확정), secret 값 없음', () => {
  const raw = fs.readFileSync(
    new URL('../server/cloudflare-worker/wrangler.toml', import.meta.url),
    'utf8',
  );
  // 주석(#...) 을 제거해 실제 설정 라인만 검사한다.
  const toml = raw.replace(/#[^\n]*/g, '');
  assert.match(toml, /FCM_NOTIFICATIONS_ENABLED\s*=\s*"true"/);
  assert.doesNotMatch(toml, /FCM_PRIVATE_KEY\s*=/, 'private key 가 toml 설정에 있으면 안 됨');
  assert.doesNotMatch(toml, /FCM_CLIENT_EMAIL\s*=/, 'client_email 이 toml 설정에 있으면 안 됨');
  assert.doesNotMatch(toml, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(raw, /-----BEGIN/, 'PEM 블록이 toml 에 있으면 안 됨');
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.4 STEP 1 — FCM 전환 알림 파이프라인 smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
