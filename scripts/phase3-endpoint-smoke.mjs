/**
 * Phase 3 endpoint 스모크 테스트 — 네트워크/Firestore 없이 순수 로직만 검증한다.
 *
 * 실행:  node scripts/phase3-endpoint-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - Cloudflare Worker 의 요청/디바이스 검증 (validate.js)
 *   - events 문서 생성 로직 (buildEvent.js) — 서버 timestamp, source, location, payload
 *   - Firestore REST value 변환 (firestore.js) round-trip
 *   - Worker 출력 → 앱 매퍼(docToCareEvent) → eventPresenter 까지 end-to-end (순수)
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  validateRequest,
  validateDevice,
  validateHeartbeatRequest,
  validateHeartbeatDevice,
  safeEqual,
  ALLOWED_EVENT_TYPES,
} from '../server/cloudflare-worker/src/validate.js';
import { buildEventDoc } from '../server/cloudflare-worker/src/buildEvent.js';
import {
  toFirestoreFields,
  fromFirestoreFields,
  toFirestoreValue,
} from '../server/cloudflare-worker/src/firestore.js';
import workerHandler from '../server/cloudflare-worker/src/index.js';

import { docToCareEvent } from '../src/mappers/firestoreEventMapper.ts';
import { presentEvent } from '../src/utils/eventPresenter.ts';

const KEY = 'test-device-key-abc123';
const DEVICE = {
  careRecipientId: 'dev-care-recipient',
  name: '거실 센서',
  type: 'ESP32_PIR',
  location: '거실',
  enabled: true,
};

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── validate.js: 요청 검증 ──────────────────────────────────────────────
check('validateRequest: 정상 요청 통과', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: KEY, body: { deviceId: 'dev-device-livingroom', eventType: 'motion_detected' } },
    { expectedDeviceKey: KEY },
  );
  assert.deepEqual(r, { ok: true, deviceId: 'dev-device-livingroom', eventType: 'motion_detected' });
});

check('validateRequest: GET → 405', () => {
  const r = validateRequest({ method: 'GET', deviceKeyHeader: KEY, body: null }, { expectedDeviceKey: KEY });
  assert.equal(r.ok, false);
  assert.equal(r.status, 405);
});

check('validateRequest: 서버에 DEVICE_KEY 미설정 → 500', () => {
  const r = validateRequest({ method: 'POST', deviceKeyHeader: 'x', body: {} }, { expectedDeviceKey: '' });
  assert.equal(r.status, 500);
  assert.equal(r.error, 'server_misconfigured_no_device_key');
});

check('validateRequest: 잘못된 key → 401', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: 'wrong', body: { deviceId: 'd', eventType: 'motion_detected' } },
    { expectedDeviceKey: KEY },
  );
  assert.equal(r.status, 401);
});

check('validateRequest: key 누락 → 401', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: null, body: { deviceId: 'd', eventType: 'motion_detected' } },
    { expectedDeviceKey: KEY },
  );
  assert.equal(r.status, 401);
});

check('validateRequest: body 가 객체 아님 → 400 invalid_json_body', () => {
  const r = validateRequest({ method: 'POST', deviceKeyHeader: KEY, body: null }, { expectedDeviceKey: KEY });
  assert.equal(r.status, 400);
  assert.equal(r.error, 'invalid_json_body');
});

check('validateRequest: deviceId 누락 → 400', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: KEY, body: { eventType: 'motion_detected' } },
    { expectedDeviceKey: KEY },
  );
  assert.equal(r.error, 'missing_deviceId');
});

check('validateRequest: eventType 누락 → 400', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: KEY, body: { deviceId: 'd' } },
    { expectedDeviceKey: KEY },
  );
  assert.equal(r.error, 'missing_eventType');
});

check('validateRequest: 허용되지 않은 eventType → 400', () => {
  const r = validateRequest(
    { method: 'POST', deviceKeyHeader: KEY, body: { deviceId: 'd', eventType: 'MOTION_DETECTED' } },
    { expectedDeviceKey: KEY },
  );
  assert.equal(r.error, 'unsupported_eventType');
});

check('ALLOWED_EVENT_TYPES 는 앱 도메인 값(소문자 snake_case)', () => {
  assert.ok(ALLOWED_EVENT_TYPES.includes('motion_detected'));
  assert.ok(ALLOWED_EVENT_TYPES.every((t) => t === t.toLowerCase()));
});

check('safeEqual: 상수시간 비교 동작', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
  assert.equal(safeEqual(null, 'abc'), false);
});

// ── validate.js: 디바이스 검증 ─────────────────────────────────────────
check('validateDevice: 정상 PIR + motion_detected → ok', () => {
  assert.deepEqual(validateDevice(DEVICE, 'motion_detected'), { ok: true });
});

check('validateDevice: 문서 없음 → 404', () => {
  assert.equal(validateDevice(null, 'motion_detected').status, 404);
});

check('validateDevice: enabled=false → 403', () => {
  assert.equal(validateDevice({ ...DEVICE, enabled: false }, 'motion_detected').status, 403);
});

check('validateDevice: careRecipientId 없음 → 422', () => {
  const r = validateDevice({ ...DEVICE, careRecipientId: '' }, 'motion_detected');
  assert.equal(r.status, 422);
  assert.equal(r.error, 'device_missing_careRecipientId');
});

check('validateDevice: 알 수 없는 type → 422', () => {
  assert.equal(validateDevice({ ...DEVICE, type: 'NEST_CAM' }, 'motion_detected').error, 'unsupported_device_type');
});

check('validateDevice: PIR 인데 door_opened → 422', () => {
  assert.equal(
    validateDevice(DEVICE, 'door_opened').error,
    'event_type_not_allowed_for_device',
  );
});

// ── buildEvent.js ──────────────────────────────────────────────────────
check('buildEventDoc: 서버가 시간/source/location/payload 채움', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');
  const doc = buildEventDoc({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', device: DEVICE, now });
  assert.equal(doc.careRecipientId, 'dev-care-recipient');
  assert.equal(doc.deviceId, 'dev-device-livingroom');
  assert.equal(doc.eventType, 'motion_detected');
  assert.equal(doc.source, 'sensor');
  assert.equal(doc.location, '거실');
  assert.deepEqual(doc.payload, { origin: 'esp32', deviceType: 'ESP32_PIR' });
  assert.equal(doc.occurredAt.toISOString(), '2026-09-03T12:00:00.000Z');
  assert.equal(doc.createdAt.toISOString(), '2026-09-03T12:00:00.000Z');
});

check('buildEventDoc: location 없는 디바이스 → null', () => {
  const doc = buildEventDoc({ deviceId: 'd', eventType: 'motion_detected', device: { ...DEVICE, location: '' } });
  assert.equal(doc.location, null);
});

// ── firestore.js: REST value 변환 ─────────────────────────────────────
check('toFirestoreValue: 타입별 변환', () => {
  assert.deepEqual(toFirestoreValue('x'), { stringValue: 'x' });
  assert.deepEqual(toFirestoreValue(true), { booleanValue: true });
  assert.deepEqual(toFirestoreValue(3), { integerValue: '3' });
  assert.deepEqual(toFirestoreValue(null), { nullValue: null });
  assert.deepEqual(toFirestoreValue(new Date('2026-09-03T12:00:00Z')), {
    timestampValue: '2026-09-03T12:00:00.000Z',
  });
});

check('toFirestoreFields → fromFirestoreFields round-trip', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');
  const doc = buildEventDoc({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', device: DEVICE, now });
  const fields = toFirestoreFields(doc);
  // Firestore REST 문서 형태 확인
  assert.equal(fields.eventType.stringValue, 'motion_detected');
  assert.equal(fields.occurredAt.timestampValue, '2026-09-03T12:00:00.000Z');
  assert.equal(fields.payload.mapValue.fields.origin.stringValue, 'esp32');

  const back = fromFirestoreFields(fields);
  assert.equal(back.eventType, 'motion_detected');
  assert.equal(back.location, '거실');
  assert.deepEqual(back.payload, { origin: 'esp32', deviceType: 'ESP32_PIR' });
  assert.equal(back.occurredAt, '2026-09-03T12:00:00.000Z');
});

// ── end-to-end (순수): Worker 출력 → 앱 매퍼 → 사용자 문구 ────────────
check('end-to-end: PIR 이벤트가 앱에서 "거실에서 활동이 확인됐어요."', () => {
  const now = new Date('2026-09-03T16:32:00.000Z');
  const doc = buildEventDoc({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', device: DEVICE, now });

  // Firestore SDK 가 앱에 돌려주는 형태를 흉내 (Timestamp = {toDate})
  const sdkShape = {
    ...doc,
    occurredAt: { toDate: () => doc.occurredAt },
    createdAt: { toDate: () => doc.createdAt },
  };
  const careEvent = docToCareEvent('evt_generated_id', sdkShape);

  assert.equal(careEvent.eventType, 'motion_detected');
  assert.equal(careEvent.source, 'sensor');
  assert.equal(careEvent.careRecipientId, 'dev-care-recipient');
  assert.equal(careEvent.deviceId, 'dev-device-livingroom');
  assert.equal(careEvent.occurredAt, '2026-09-03T16:32:00.000Z');
  assert.deepEqual(careEvent.metadata, { origin: 'esp32', deviceType: 'ESP32_PIR' });
  assert.equal(presentEvent(careEvent).message, '거실에서 활동이 확인됐어요.');
});

check('worker index.js: 핸들러 export 정상', () => {
  assert.equal(typeof workerHandler.fetch, 'function');
});

// ── Phase 4.1a: ingest 성공 시 devices/{id}.lastEventAt best-effort 갱신 ─
//
//   Firestore REST 를 fetch 로 흉내낸다:
//     GET  /devices/{id}   → device 문서
//     POST /events         → 생성된 문서
//     PATCH /devices/{id}?updateMask.fieldPaths=lastEventAt → lastEventAt touch
//
function mockFirestore({ failWrite = false, deviceMissing = false, deviceDisabled = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    // OAuth 토큰 요청은 form-urlencoded 바디라 JSON.parse 하면 안 된다 (Phase 5.3-A).
    const parsedBody =
      opts.body && typeof opts.body === 'string' && opts.body.startsWith('{')
        ? JSON.parse(opts.body)
        : opts.body;
    calls.push({ url: u, method, body: parsedBody });

    if (u.includes('oauth2.googleapis.com/token') && method === 'POST') {
      return new Response(JSON.stringify({ access_token: 'ya29.TEST', expires_in: 3599 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('/devices/') && method === 'GET') {
      if (deviceMissing) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({
          name: 'projects/p/databases/(default)/documents/devices/dev-device-livingroom',
          fields: toFirestoreFields({
            careRecipientId: 'dev-care-recipient',
            name: '거실 센서',
            type: 'ESP32_PIR',
            location: '거실',
            enabled: !deviceDisabled,
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/events') && method === 'POST') {
      return new Response(
        JSON.stringify({ name: 'projects/p/databases/(default)/documents/events/evt_abc' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.includes('/devices/') && method === 'PATCH') {
      if (failWrite) return new Response('permission denied', { status: 403 });
      return new Response(JSON.stringify({ name: 'projects/p/.../devices/dev-device-livingroom' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('unexpected ' + method + ' ' + u, { status: 500 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

// Phase 5.3-A — Firestore REST 도 이제 OAuth 인증이 필요하다 (FCM 과 동일 secret 재사용).
// 실제 RSA 키로 서명해야 createGoogleAccessToken() 의 Web Crypto importKey 가 통과한다.
const { privateKey: TEST_PRIV } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const WORKER_ENV = {
  FIREBASE_PROJECT_ID: 'p',
  DEVICE_KEY: KEY,
  FCM_CLIENT_EMAIL: 'sa@p.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: TEST_PRIV,
};
const ingestReq = () =>
  new Request('https://w.example/ingest-device-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-key': KEY },
    body: JSON.stringify({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected' }),
  });
const heartbeatReq = (over = {}) =>
  new Request('https://w.example/device-heartbeat', {
    method: over.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(over.noKey ? {} : { 'x-device-key': over.key ?? KEY }),
    },
    body: JSON.stringify(over.body ?? { deviceId: 'dev-device-livingroom' }),
  });

// ── ingest (Phase 4.1a) 회귀 ──────────────────────────────────────────
check('4.1a: ingest 성공 → events 생성 후 devices lastEventAt PATCH 시도', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(ingestReq(), WORKER_ENV);
    assert.equal(res.status, 201);
    const patch = m.calls.find((c) => c.method === 'PATCH');
    assert.ok(patch, 'PATCH 호출이 있어야 한다');
    assert.ok(patch.url.includes('/devices/dev-device-livingroom'));
    assert.ok(patch.url.includes('updateMask.fieldPaths=lastEventAt'));
    assert.ok(!patch.url.includes('lastHeartbeatAt')); // ingest 는 heartbeat 안 건드림
    const order = m.calls.map((c) => c.method);
    assert.ok(order.indexOf('POST') < order.indexOf('PATCH'));
  } finally {
    m.restore();
  }
});

check('4.1a: lastEventAt PATCH 실패해도 ingest 는 201 유지 (best-effort)', async () => {
  const m = mockFirestore({ failWrite: true });
  try {
    const res = await workerHandler.fetch(ingestReq(), WORKER_ENV);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).ok, true);
    assert.ok(m.calls.some((c) => c.method === 'PATCH'));
  } finally {
    m.restore();
  }
});

// ── /device-heartbeat (Phase 4.1b) ───────────────────────────────────
check('4.1b: heartbeat 정상 → 200 { ok:true, deviceId, lastHeartbeatAt }', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.deviceId, 'dev-device-livingroom');
    assert.ok(typeof body.lastHeartbeatAt === 'string');
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat → events 문서 생성 안 함', async () => {
  const m = mockFirestore();
  try {
    await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    assert.ok(!m.calls.some((c) => /\/events/.test(c.url) && c.method === 'POST'));
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat → devices lastHeartbeatAt 만 PATCH', async () => {
  const m = mockFirestore();
  try {
    await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    const patch = m.calls.find((c) => c.method === 'PATCH');
    assert.ok(patch);
    assert.ok(patch.url.includes('updateMask.fieldPaths=lastHeartbeatAt'));
    assert.ok(!patch.url.includes('lastEventAt'));
    assert.ok(patch.body.fields.lastHeartbeatAt.timestampValue);
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat X-Device-Key 없음 → 401', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(heartbeatReq({ noKey: true }), WORKER_ENV);
    assert.equal(res.status, 401);
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat 잘못된 key → 401', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(heartbeatReq({ key: 'wrong' }), WORKER_ENV);
    assert.equal(res.status, 401);
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat deviceId 없음 → 400', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(heartbeatReq({ body: {} }), WORKER_ENV);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'missing_deviceId');
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat 존재하지 않는 device → 404', async () => {
  const m = mockFirestore({ deviceMissing: true });
  try {
    const res = await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'device_not_found');
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat disabled device → 403', async () => {
  const m = mockFirestore({ deviceDisabled: true });
  try {
    const res = await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'device_disabled');
  } finally {
    m.restore();
  }
});

check('4.1b: heartbeat Firestore write 실패 → 5xx (best-effort 아님)', async () => {
  const m = mockFirestore({ failWrite: true });
  try {
    const res = await workerHandler.fetch(heartbeatReq(), WORKER_ENV);
    assert.ok(res.status >= 500 && res.status < 600, `status=${res.status}`);
    assert.equal((await res.json()).error, 'firestore_write_failed');
  } finally {
    m.restore();
  }
});

check('4.1b: 기존 ingest-device-event 회귀 없음 (heartbeat 추가 후에도 201)', async () => {
  const m = mockFirestore();
  try {
    const res = await workerHandler.fetch(ingestReq(), WORKER_ENV);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).eventType, 'motion_detected');
  } finally {
    m.restore();
  }
});

check('4.1b: GET /health 응답 불변', async () => {
  const res = await workerHandler.fetch(
    new Request('https://w.example/health', { method: 'GET' }),
    WORKER_ENV,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.endpoint, '/ingest-device-event');
});

// ── validateHeartbeatRequest / validateHeartbeatDevice 순수 검증 ──────
check('validateHeartbeatRequest: 정상 / GET 405 / key 없음 401 / deviceId 없음 400', () => {
  assert.deepEqual(
    validateHeartbeatRequest(
      { method: 'POST', deviceKeyHeader: KEY, body: { deviceId: 'd' } },
      { expectedDeviceKey: KEY },
    ),
    { ok: true, deviceId: 'd' },
  );
  assert.equal(
    validateHeartbeatRequest({ method: 'GET', deviceKeyHeader: KEY, body: {} }, { expectedDeviceKey: KEY }).status,
    405,
  );
  assert.equal(
    validateHeartbeatRequest({ method: 'POST', deviceKeyHeader: null, body: { deviceId: 'd' } }, { expectedDeviceKey: KEY }).status,
    401,
  );
  assert.equal(
    validateHeartbeatRequest({ method: 'POST', deviceKeyHeader: KEY, body: {} }, { expectedDeviceKey: KEY }).error,
    'missing_deviceId',
  );
});

check('validateHeartbeatDevice: null 404 / disabled 403 / 정상 ok', () => {
  assert.equal(validateHeartbeatDevice(null).status, 404);
  assert.equal(validateHeartbeatDevice({ enabled: false }).status, 403);
  assert.deepEqual(validateHeartbeatDevice({ enabled: true }), { ok: true });
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 3 endpoint smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
