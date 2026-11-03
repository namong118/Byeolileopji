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
import { selectActiveLink, selectDemoLink } from '../src/services/guardianLink.ts';
import { presentEvent } from '../src/utils/eventPresenter.ts';
import { DEFAULT_LYING_ALERT_SECONDS, computePostureAlert } from '../src/utils/posture.ts';
import { isFreshSnapshotEvent, matchSnapshot, readSnapshotSeq } from '../src/utils/snapshot.ts';

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
  // 웹 데모 모드는 데모 연결만 고르고, 없으면 실제 대상으로 fallback 하지 않는다.
  const links = [
    { guardianUid: 'u', careRecipientId: real, enabled: true },
    { guardianUid: 'u', careRecipientId: DEMO_RECIPIENT_ID_DEFAULT, enabled: true },
  ];
  assert.equal(selectDemoLink(links, DEMO_RECIPIENT_ID_DEFAULT)?.careRecipientId, DEMO_RECIPIENT_ID_DEFAULT);
  assert.equal(selectDemoLink(links.slice(0, 1), DEMO_RECIPIENT_ID_DEFAULT), null);
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

// ── 앱 표시: 자세 문구 + "확인이 필요해요" 배지 (순수 함수) ─────────────
const pev = (id, location, posture, iso, confidence = 0.9) => ({
  id,
  eventType: 'motion_detected',
  source: 'sensor',
  location,
  occurredAt: iso,
  metadata: { origin: 'esp32', deviceType: 'ESP32_POSTURE', posture, confidence },
});
const T0 = '2026-11-03T05:00:00.000Z';
const at = (sec) => new Date(Date.parse(T0) + sec * 1000);

check('presentEvent: 자세 문구 / PIR 문구는 그대로', () => {
  assert.equal(presentEvent(pev('a', '거실', 'sitting', T0)).message, '거실에서 앉아 있어요.');
  assert.equal(presentEvent(pev('b', '침대', 'lying', T0)).message, '침대에 누워 있어요.');
  assert.equal(presentEvent(pev('c', '부엌', 'standing', T0)).message, '부엌에서 서 있어요.');
  const pir = { id: 'p', eventType: 'motion_detected', source: 'sensor', location: '거실', occurredAt: T0 };
  assert.equal(presentEvent(pir).message, '거실에서 활동이 확인됐어요.');
});

check('배지: 새 이벤트 없이 경과 시간만으로 30초 기준 판정 (침대 제외)', () => {
  const lyingLiving = [pev('1', '거실', 'sitting', T0), pev('2', '거실', 'lying', at(5).toISOString())];
  // 마지막 lying 이후 이벤트가 더 오지 않아도, now 만 흐르면 배지가 켜진다.
  assert.equal(computePostureAlert(lyingLiving, at(5 + 29), 30_000).needsCheck, false);
  const on = computePostureAlert(lyingLiving, at(5 + 30), 30_000);
  assert.equal(on.needsCheck, true);
  assert.equal(on.lyingElapsedMs, 30_000);
  assert.equal(on.latest?.location, '거실');
  // 침대에서는 오래 누워 있어도 배지 없음
  const bed = [pev('3', '침대', 'lying', T0)];
  assert.equal(computePostureAlert(bed, at(600), 30_000).needsCheck, false);
  // 일어나면(최신 자세가 lying 아님) 꺼진다 — 입력 순서와 무관
  const up = [pev('5', '거실', 'standing', at(40).toISOString()), ...lyingLiving];
  assert.equal(computePostureAlert(up, at(100), 30_000).needsCheck, false);
  // 자세 이벤트가 없으면 latest=null
  assert.equal(computePostureAlert([], at(0)).latest, null);
  assert.equal(DEFAULT_LYING_ALERT_SECONDS, 30);
});

// ── 판단 근거 스냅샷: snapshotSeq (번호만, 사진은 서버로 오지 않음) ─────
check('snapshotSeq: 정수 ≥0 통과 → payload 저장, 잘못된 값 400', () => {
  const base = { deviceId: 'xiao-living', eventType: 'motion_detected', posture: 'lying', confidence: 0.8 };
  assert.equal(req({ ...base, snapshotSeq: 0 }).snapshotSeq, 0);
  assert.equal(req({ ...base, snapshotSeq: 42 }).snapshotSeq, 42);
  for (const snapshotSeq of [-1, 1.5, '3', null, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(req({ ...base, snapshotSeq }).error, 'invalid_snapshotSeq', `snapshotSeq=${snapshotSeq}`);
  }
  assert.equal('snapshotSeq' in req(base), false); // 없으면 결과에도 없음
  const doc = buildEventDoc({ deviceId: 'xiao-living', eventType: 'motion_detected', device: XIAO, posture: 'lying', snapshotSeq: 42 });
  assert.equal(doc.payload.snapshotSeq, 42);
  const noSeq = buildEventDoc({ deviceId: 'xiao-living', eventType: 'motion_detected', device: XIAO, posture: 'lying' });
  assert.equal('snapshotSeq' in noSeq.payload, false);
  // PIR 기기는 snapshotSeq 도 보낼 수 없다 (index.js 가 hasPosture 로 넘긴다)
  assert.equal(validateDevice(PIR, 'motion_detected', { hasPosture: true }).ok, false);
});

check('ingest: snapshotSeq → payload integerValue / PIR + snapshotSeq → 422', async () => {
  let m = mockFirestore(XIAO);
  try {
    const res = await ingest({ deviceId: 'xiao-living', eventType: 'motion_detected', posture: 'sitting', confidence: 0.7, snapshotSeq: 7 });
    assert.equal(res.status, 201);
    const post = m.calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    assert.equal(post.body.fields.payload.mapValue.fields.snapshotSeq.integerValue, '7');
  } finally {
    m.restore();
  }
  m = mockFirestore(PIR);
  try {
    const res = await ingest({ deviceId: 'dev-device-livingroom', eventType: 'motion_detected', snapshotSeq: 1 });
    assert.equal(res.status, 422);
  } finally {
    m.restore();
  }
});

check('웹 스냅샷 매칭: 번호 일치만 붙이고, 화면 연 뒤 이벤트만 받는다', () => {
  const e = { ...pev('s', '거실', 'lying', T0), metadata: { posture: 'lying', snapshotSeq: 5 } };
  assert.equal(readSnapshotSeq(e), 5);
  assert.equal(readSnapshotSeq(pev('n', '거실', 'lying', T0)), undefined);
  assert.equal(matchSnapshot(5, '5'), 'match');
  assert.equal(matchSnapshot(5, '6'), 'stale'); // 그 사이 다음 확정이 덮어씀 → 사진 없음
  assert.equal(matchSnapshot(5, null), 'unknown');
  const since = Date.parse(T0);
  assert.equal(isFreshSnapshotEvent(e, since), true);
  assert.equal(isFreshSnapshotEvent(e, since + 60_000), false); // 화면 열기 전 이벤트
  assert.equal(isFreshSnapshotEvent(pev('n', '거실', 'lying', T0), since), false);
});

console.log('XIAO posture smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
