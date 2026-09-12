/**
 * Phase 5 STEP 5.3-A — Worker Firestore OAuth 인증 스모크.
 *
 * 실행:  node scripts/phase53-worker-oauth-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상 (server/cloudflare-worker/src/firestoreAuth.js, firestore.js):
 *   - Firestore REST 호출에 Authorization 헤더가 실제로 붙는지 (Bearer 스킴)
 *   - JWT claim 의 scope 가 FCM 이 아니라 datastore 인지
 *   - 토큰 발급 실패(oauth non-2xx) 시 Firestore 요청을 아예 시도하지 않는지
 *   - credential 미설정 시 무인증으로 진행하지 않고 즉시 실패하는지
 *   - Firestore 자체의 401/403 응답이 FirestoreError 로 전달되는지
 *   - 토큰이 isolate 스코프에서 캐싱되고(중복 발급 없음), 만료 5분 전에는 재발급되는지
 *
 * 실제 네트워크 호출 없음 — fetch mock. production deploy 없음.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  getFirestoreAccessToken,
  resolveFirestoreAuthConfig,
  FirestoreAuthError,
  _resetFirestoreAccessTokenCacheForTest,
} from '../server/cloudflare-worker/src/firestoreAuth.js';
import { getDevice } from '../server/cloudflare-worker/src/firestore.js';
import { FirestoreError } from '../server/cloudflare-worker/src/firestore.js';

const { privateKey: TEST_PRIV } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENV = {
  FIREBASE_PROJECT_ID: 'byeolileopji',
  FCM_CLIENT_EMAIL: 'sa@byeolileopji.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: TEST_PRIV,
};

function b64urlToBuf(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** oauth2 토큰 엔드포인트 + Firestore REST 를 함께 흉내내는 mock. */
function mockAll({ oauthStatus = 200, firestoreStatus = 200, onOauthCall } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ u, method, headers: opts.headers ?? {} });

    if (u.includes('oauth2.googleapis.com/token')) {
      onOauthCall?.(opts);
      if (oauthStatus !== 200) {
        return new Response('{"error":"invalid_grant"}', { status: oauthStatus });
      }
      return new Response(
        JSON.stringify({ access_token: 'ya29.TESTTOKEN', expires_in: 3599 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (u.includes('/devices/')) {
      if (firestoreStatus === 404) return new Response('{}', { status: 404 });
      if (firestoreStatus !== 200) {
        return new Response(JSON.stringify({ error: { code: firestoreStatus } }), {
          status: firestoreStatus,
        });
      }
      return new Response(JSON.stringify({ name: 'x', fields: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(`UNEXPECTED ${method} ${u}`, { status: 599 });
  };
  return {
    calls,
    oauthCalls: () => calls.filter((c) => c.u.includes('oauth2.googleapis.com/token')),
    restore() {
      globalThis.fetch = original;
    },
  };
}

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('resolveFirestoreAuthConfig — FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY 재사용, 새 secret 이름 없음', () => {
  const c = resolveFirestoreAuthConfig(ENV);
  assert.equal(c.configured, true);
  assert.equal(c.clientEmail, ENV.FCM_CLIENT_EMAIL);
  assert.equal(c.privateKey, ENV.FCM_PRIVATE_KEY);
});

check('resolveFirestoreAuthConfig — credential 미설정 → configured:false (무인증 진행 안 함)', () => {
  assert.equal(resolveFirestoreAuthConfig({}).configured, false);
  assert.equal(resolveFirestoreAuthConfig({ FIREBASE_PROJECT_ID: 'p' }).configured, false);
});

check('getFirestoreAccessToken — credential 미설정 → FirestoreAuthError, fetch 시도 안 함', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  const m = mockAll();
  try {
    await assert.rejects(
      () => getFirestoreAccessToken({ FIREBASE_PROJECT_ID: 'p' }),
      FirestoreAuthError,
    );
    assert.equal(m.calls.length, 0, 'credential 없으면 네트워크 호출 자체를 안 해야 함');
  } finally {
    m.restore();
  }
});

check('getFirestoreAccessToken — scope 는 datastore (FCM scope 아님)', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  let capturedAssertion;
  const m = mockAll({ onOauthCall: (opts) => {
    capturedAssertion = new URLSearchParams(opts.body).get('assertion');
  }});
  try {
    await getFirestoreAccessToken(ENV);
    const [, payload] = capturedAssertion.split('.');
    const claim = JSON.parse(b64urlToBuf(payload).toString());
    assert.equal(claim.scope, 'https://www.googleapis.com/auth/datastore');
    assert.notEqual(claim.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  } finally {
    m.restore();
  }
});

check('getFirestoreAccessToken — 토큰 발급 실패(oauth non-2xx) → FirestoreAuthError, throw (무인증 진행 없음)', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  const m = mockAll({ oauthStatus: 400 });
  try {
    await assert.rejects(() => getFirestoreAccessToken(ENV), FirestoreAuthError);
  } finally {
    m.restore();
  }
});

check('getDevice — 토큰 발급 실패 시 Firestore 요청 자체를 시도하지 않는다', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  const m = mockAll({ oauthStatus: 400 });
  try {
    await assert.rejects(() => getDevice(ENV, 'dev-device-livingroom'));
    const firestoreCalls = m.calls.filter((c) => c.u.includes('/devices/'));
    assert.equal(firestoreCalls.length, 0, 'oauth 실패 시 Firestore REST 호출이 없어야 한다');
  } finally {
    m.restore();
  }
});

check('getDevice — 실제 Firestore 호출에 Authorization: Bearer 헤더가 붙는다', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  const m = mockAll();
  try {
    await getDevice(ENV, 'dev-device-livingroom');
    const call = m.calls.find((c) => c.u.includes('/devices/'));
    assert.ok(call, 'devices GET 호출이 있어야 함');
    const authHeader = call.headers.authorization;
    assert.ok(authHeader, 'Authorization 헤더 없음');
    assert.match(authHeader, /^Bearer .+/, 'Bearer 스킴이어야 함');
    assert.ok(!call.u.includes('key='), '?key= API key 파라미터가 남아있으면 안 됨');
  } finally {
    m.restore();
  }
});

check('getDevice — Firestore 401/403 → FirestoreError(status) 로 전달', async () => {
  for (const status of [401, 403]) {
    _resetFirestoreAccessTokenCacheForTest();
    const m = mockAll({ firestoreStatus: status });
    try {
      await assert.rejects(
        () => getDevice(ENV, 'dev-device-livingroom'),
        (err) => err instanceof FirestoreError && err.status === status,
      );
    } finally {
      m.restore();
    }
  }
});

check('getFirestoreAccessToken — 같은 isolate 내에서 캐싱, 중복 발급 없음', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  const m = mockAll();
  try {
    const t1 = await getFirestoreAccessToken(ENV);
    const t2 = await getFirestoreAccessToken(ENV);
    assert.equal(t1, t2);
    assert.equal(m.oauthCalls().length, 1, '두 번째 호출은 캐시를 써야 함(oauth 재호출 없음)');
  } finally {
    m.restore();
  }
});

check('getFirestoreAccessToken — 만료 5분 이내로 다가오면 재발급한다', async () => {
  _resetFirestoreAccessTokenCacheForTest();
  // expires_in 을 6분(360초)으로 짧게 설정 — margin(5분) 안쪽으로 곧 들어간다.
  const calls = [];
  const original = globalThis.fetch;
  let oauthCallCount = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      oauthCallCount += 1;
      return new Response(JSON.stringify({ access_token: `tok-${oauthCallCount}`, expires_in: 360 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  };
  const realDateNow = Date.now;
  try {
    const t1 = await getFirestoreAccessToken(ENV);
    assert.equal(oauthCallCount, 1);
    // 실제 시각을 2분(120s) 뒤로 이동 — 남은 유효시간 360-120=240s < margin(300s) → 재발급 대상.
    Date.now = () => realDateNow() + 120_000;
    const t2 = await getFirestoreAccessToken(ENV);
    assert.equal(oauthCallCount, 2, '만료 5분 이내로 들어오면 재발급해야 함');
    assert.notEqual(t1, t2);
  } finally {
    Date.now = realDateNow;
    globalThis.fetch = original;
  }
});

console.log('Phase 5 STEP 5.3-A — Worker Firestore OAuth smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
