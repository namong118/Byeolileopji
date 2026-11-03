/**
 * XIAO ESP32-S3 Sense 자세 인식 데모 — Worker 확장 스모크.
 *
 * 실행:  node scripts/xiao-posture-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증:
 *   - ESP32_POSTURE 기기 등록 / motion_detected 만 허용
 *   - 선택 필드 posture(standing|sitting|lying) / confidence(0~1) 검증 → events.payload 저장
 *   - posture 가 없는 기존 PIR 요청은 결과·payload 가 예전과 완전히 같다
 *   - PIR 기기가 posture 를 보내면 거부
 *   - 데모 레지스트리(scripts/register-xiao-demo-devices.mjs)가 실제 보호대상과 분리된다
 *     (Cron 대상 CARE_RECIPIENT_ID 와 다르고, 사전순으로 뒤 → 앱 selectActiveLink 가 고르지 않음)
 *   - ingest 엔드투엔드(mock fetch): XIAO 요청 → 201, payload.posture/confidence 기록
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  ALLOWED_DEVICE_TYPES,
  DEVICE_TYPE_EVENTS,
  validateDevice,
  validateRequest,
} from '../server/cloudflare-worker/src/validate.js';
import { buildEventDoc } from '../server/cloudflare-worker/src/buildEvent.js';
import { resolveScheduledTargets } from '../server/cloudflare-worker/src/scheduled.js';
import { toFirestoreFields } from '../server/cloudflare-worker/src/firestore.js';
import workerHandler from '../server/cloudflare-worker/src/index.js';
import {
  DEMO_RECIPIENT_ID_DEFAULT,
  XIAO_DEMO_DEVICES,
  buildDemoRegistry,
} from './register-xiao-demo-devices.mjs';
import { docToCareEvent } from '../src/mappers/firestoreEventMapper.ts';
import { selectActiveLink } from '../src/services/guardianLink.ts';

const KEY = 'test-device-key-xiao';
const XIAO = {
  careRecipientId: DEMO_RECIPIENT_ID_DEFAULT,
  type: 'ESP32_POSTURE',
  location: '거실',
  enabled: true,
};
const PIR = { careRecipientId: 'dev-care-recipient', type: 'ESP32_PIR', location: '거실', enabled: true };
const req = (body) =>
  validateRequest({ method: 'POST', deviceKeyHeader: KEY, body }, { expectedDeviceKey: KEY });

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('ESP32_POSTURE 등록 + motion_detected 만 허용', () => {
  assert.ok(ALLOWED_DEVICE_TYPES.includes('ESP32_POSTURE'));
  assert.deepEqual(DEVICE_TYPE_EVENTS.ESP32_POSTURE, ['motion_detected']);
  assert.deepEqual(validateDevice(XIAO, 'motion_detected', { hasPosture: true }), { ok: true });
  assert.equal(validateDevice(XIAO, 'sos_triggered').error, 'event_type_not_allowed_for_device');
});

check('posture/confidence 정상 값 통과', () => {
  for (const posture of ['standing', 'sitting', 'lying']) {
    const r = req({ deviceId: 'xiao-living', eventType: 'motion_detected', posture, confidence: 0.83 });
    assert.deepEqual(r, {
      ok: true,
      deviceId: 'xiao-living',
      eventType: 'motion_detected',
      posture,
      confidence: 0.83,
    });
  }
  assert.equal(req({ deviceId: 'x', eventType: 'motion_detected', confidence: 0 }).confidence, 0);
  assert.equal(req({ deviceId: 'x', eventType: 'motion_detected', confidence: 1 }).confidence, 1);
});

check('posture/confidence 잘못된 값 → 400', () => {
  const base = { deviceId: 'x', eventType: 'motion_detected' };
  for (const posture of ['no_person', 'LYING', '', 1, null]) {
    assert.equal(req({ ...base, posture }).error, 'invalid_posture', `posture=${posture}`);
  }
  for (const confidence of [-0.01, 1.01, '0.5', NaN, Infinity, null]) {
    assert.equal(req({ ...base, confidence }).error, 'invalid_confidence', `confidence=${confidence}`);
  }
});

check('기존 PIR 요청(posture 없음)은 예전과 동일', () => {
  const r = req({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected' });
  assert.deepEqual(r, { ok: true, deviceId: 'dev-device-livingroom', eventType: 'motion_detected' });
  assert.deepEqual(validateDevice(PIR, 'motion_detected'), { ok: true });
  const doc = buildEventDoc({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', device: PIR });
  assert.deepEqual(doc.payload, { origin: 'esp32', deviceType: 'ESP32_PIR' });
});

check('PIR 기기가 posture 를 보내면 422', () => {
  assert.equal(
    validateDevice(PIR, 'motion_detected', { hasPosture: true }).error,
    'posture_not_allowed_for_device',
  );
});

check('buildEventDoc → payload.posture/confidence → 앱 metadata', () => {
  const now = new Date('2026-11-03T05:00:00Z');
  const doc = buildEventDoc({
    deviceId: 'xiao-living',
    eventType: 'motion_detected',
    device: XIAO,
    now,
    posture: 'sitting',
    confidence: 0.9,
  });
  assert.equal(doc.location, '거실');
  assert.equal(doc.careRecipientId, DEMO_RECIPIENT_ID_DEFAULT);
  assert.deepEqual(doc.payload, {
    origin: 'esp32',
    deviceType: 'ESP32_POSTURE',
    posture: 'sitting',
    confidence: 0.9,
  });
  const ev = docToCareEvent('e1', { ...doc, occurredAt: now.toISOString() });
  assert.equal(ev.eventType, 'motion_detected');
  assert.equal(ev.location, '거실');
  assert.equal(ev.metadata?.posture, 'sitting');
  assert.equal(ev.metadata?.confidence, 0.9);
});

check('데모 레지스트리: 기기 3대 + guardianLink, 실제 보호대상과 분리', () => {
  const docs = buildDemoRegistry({ guardianUid: 'uid123' });
  assert.deepEqual(
    XIAO_DEMO_DEVICES.map((d) => d.location),
    ['거실', '부엌', '침대'],
  );
  for (const { deviceId, location } of XIAO_DEMO_DEVICES) {
    const d = docs.find((x) => x.path === `devices/${deviceId}`);
    assert.ok(d, deviceId);
    assert.equal(d.fields.type, 'ESP32_POSTURE');
    assert.equal(d.fields.location, location);
    assert.equal(d.fields.careRecipientId, DEMO_RECIPIENT_ID_DEFAULT);
    assert.equal(validateDevice(d.fields, 'motion_detected', { hasPosture: true }).ok, true);
  }
  const link = docs.find((x) => x.path.startsWith('guardianLinks/'));
  assert.equal(link.path, `guardianLinks/uid123_${DEMO_RECIPIENT_ID_DEFAULT}`);
  assert.equal(link.fields.careRecipientId, DEMO_RECIPIENT_ID_DEFAULT);
  assert.throws(() => buildDemoRegistry({ guardianUid: '' }));
});

check('데모 격리: Cron 대상이 아니고, 앱은 실제 보호대상을 계속 고른다', () => {
  const toml = fs.readFileSync(
    new URL('../server/cloudflare-worker/wrangler.toml', import.meta.url),
    'utf8',
  );
  const real = /CARE_RECIPIENT_ID\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  const realDevice = /DEVICE_ID\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  assert.ok(real);
  const targets = resolveScheduledTargets({ CARE_RECIPIENT_ID: real, DEVICE_ID: realDevice });
  assert.ok(targets.every((t) => t.careRecipientId !== DEMO_RECIPIENT_ID_DEFAULT));
  assert.ok(targets.every((t) => !XIAO_DEMO_DEVICES.some((d) => d.deviceId === t.deviceId)));
  // 보호자가 실제 + 데모 두 연결을 가져도 기존 앱(사전순 첫 번째)은 실제 대상을 고른다.
  const active = selectActiveLink([
    { guardianUid: 'u', careRecipientId: DEMO_RECIPIENT_ID_DEFAULT, enabled: true },
    { guardianUid: 'u', careRecipientId: real, enabled: true },
  ]);
  assert.equal(active?.careRecipientId, real);
});

// ── ingest 엔드투엔드 (mock fetch) ─────────────────────────────────────
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

function mockFirestore(device) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body =
      typeof opts.body === 'string' && opts.body.startsWith('{') ? JSON.parse(opts.body) : opts.body;
    calls.push({ url: u, method, body });
    const ok = (obj) =>
      new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'ya29.T', expires_in: 3599 });
    if (u.includes('/devices/') && method === 'GET') {
      return ok({ name: 'projects/p/databases/(default)/documents/devices/x', fields: toFirestoreFields(device) });
    }
    if (u.includes('/events') && method === 'POST') {
      return ok({ name: 'projects/p/databases/(default)/documents/events/evt_x' });
    }
    if (u.includes('/devices/') && method === 'PATCH') return ok({ name: 'x' });
    return new Response('unexpected', { status: 500 });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const ingest = (body) =>
  workerHandler.fetch(
    new Request('https://w.example/ingest-device-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-key': KEY },
      body: JSON.stringify(body),
    }),
    WORKER_ENV,
  );

check('ingest: XIAO posture 요청 → 201, payload 에 posture/confidence', async () => {
  const m = mockFirestore(XIAO);
  try {
    const res = await ingest({ deviceId: 'xiao-living', eventType: 'motion_detected', posture: 'lying', confidence: 0.77 });
    assert.equal(res.status, 201);
    const post = m.calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    const p = post.body.fields.payload.mapValue.fields;
    assert.equal(p.posture.stringValue, 'lying');
    assert.equal(p.confidence.doubleValue, 0.77);
    assert.equal(post.body.fields.careRecipientId.stringValue, DEMO_RECIPIENT_ID_DEFAULT);
  } finally {
    m.restore();
  }
});

check('ingest: PIR 기기 + posture → 422, events 생성 없음', async () => {
  const m = mockFirestore(PIR);
  try {
    const res = await ingest({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', posture: 'lying' });
    assert.equal(res.status, 422);
    assert.ok(!m.calls.some((c) => c.method === 'POST' && c.url.includes('/events')));
  } finally {
    m.restore();
  }
});

check('ingest: 기존 PIR 요청 → 201, payload 변화 없음', async () => {
  const m = mockFirestore(PIR);
  try {
    const res = await ingest({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected' });
    assert.equal(res.status, 201);
    const post = m.calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    assert.deepEqual(Object.keys(post.body.fields.payload.mapValue.fields).sort(), ['deviceType', 'origin']);
  } finally {
    m.restore();
  }
});

console.log('XIAO posture smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
