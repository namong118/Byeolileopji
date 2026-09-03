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

import {
  validateRequest,
  validateDevice,
  safeEqual,
  ALLOWED_EVENT_TYPES,
} from '../server/cloudflare-worker/src/validate.js';
import { buildEventDoc } from '../server/cloudflare-worker/src/buildEvent.js';
import {
  toFirestoreFields,
  fromFirestoreFields,
  toFirestoreValue,
} from '../server/cloudflare-worker/src/firestore.js';
// index.js 도 import 해서 문법/모듈 그래프가 깨지지 않는지 확인
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

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 3 endpoint smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
