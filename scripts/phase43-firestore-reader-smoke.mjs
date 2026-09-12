/**
 * Phase 4.3 STEP B-1 — Firestore READ adapter 스모크.
 *
 * 실행:  node scripts/phase43-firestore-reader-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - normalizeCareStatusInput()  (src/services/careStatusSnapshotInput.ts) — 순수
 *   - computeCareStatusFromFirestore()  (server/cloudflare-worker/src/careStatusReader.js)
 *     : Firestore REST 를 fetch mock 으로 흉내내 READ → normalize → 공유 코어 compute
 *   - lastActivityAt 이 ACTIVITY_EVENT_TYPES (eventViews.ts) 기준으로 선택됨
 *   - Firestore WRITE 가 한 번도 일어나지 않음
 *
 * WRITE / cron / deploy 없음.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  toFirestoreFields,
  toFirestoreValue,
} from '../server/cloudflare-worker/src/firestore.js';
import {
  computeCareStatusFromFirestore,
  readCareStatusSource,
} from '../server/cloudflare-worker/src/careStatusReader.js';
import {
  normalizeCareStatusInput,
  toInstantIso,
} from '../src/services/careStatusSnapshotInput.ts';
import { ACTIVITY_EVENT_TYPES } from '../src/services/eventViews.ts';
import { DAILY_LIVING_ACTIVITY_EVENT_TYPES } from '../src/utils/todayActivity.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
const THRESHOLDS = {
  inactivityMinutes: 180,
  deviceOfflineMinutes: 25,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
};
// Phase 5.3-A — Firestore REST 도 이제 OAuth 인증이 필요하다 (FCM 과 동일 secret 재사용).
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

/**
 * Firestore REST 를 fetch 로 흉내낸다.
 *   POST oauth2.googleapis.com/token     → OAuth2 access token (Phase 5.3-A)
 *   POST .../documents:runQuery          → events 쿼리
 *   GET  .../documents/devices/{id}      → device point read
 * write(PATCH/POST /events) 가 호출되면 테스트 실패.
 */
function mockFirestore({ events = [], device = undefined, deviceMissing = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    // OAuth 토큰 요청은 form-urlencoded 바디라 JSON.parse 하면 안 된다 (Phase 5.3-A).
    const body =
      opts.body && typeof opts.body === 'string' && opts.body.startsWith('{')
        ? JSON.parse(opts.body)
        : opts.body;
    calls.push({ u, method, body });

    if (u.includes('oauth2.googleapis.com/token') && method === 'POST') {
      return new Response(JSON.stringify({ access_token: 'ya29.TEST', expires_in: 3599 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (u.includes(':runQuery') && method === 'POST') {
      const rows = events.map((e) => ({
        document: {
          name: `projects/p/databases/(default)/documents/events/${Math.random().toString(36).slice(2)}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            eventType: e.eventType,
            occurredAt: e.occurredAt instanceof Date ? e.occurredAt : new Date(e.occurredAt),
          }),
        },
        readTime: NOW.toISOString(),
      }));
      // Firestore 는 non-document 메타 항목도 섞어 보낼 수 있다 → 파서가 스킵해야 함
      rows.push({ readTime: NOW.toISOString() });
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (u.includes('/devices/') && method === 'GET') {
      if (deviceMissing) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({
          name: `projects/p/databases/(default)/documents/devices/${DEVICE_ID}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            name: '거실 센서',
            type: 'ESP32_PIR',
            location: '거실',
            enabled: true,
            ...(device?.lastEventAt ? { lastEventAt: new Date(device.lastEventAt) } : {}),
            ...(device?.lastHeartbeatAt ? { lastHeartbeatAt: new Date(device.lastHeartbeatAt) } : {}),
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    // 그 외 = 쓰기 시도 등 → 테스트 실패
    return new Response('UNEXPECTED ' + method + ' ' + u, { status: 599 });
  };
  return {
    calls,
    assertNoWrite() {
      const writes = calls.filter(
        (c) =>
          !c.u.includes('oauth2.googleapis.com') && // OAuth 토큰 발급은 Firestore write 가 아니다
          (c.method === 'PATCH' ||
            c.method === 'PUT' ||
            c.method === 'DELETE' ||
            (c.method === 'POST' && !c.u.includes(':runQuery'))),
      );
      assert.equal(writes.length, 0, `Firestore WRITE 발생: ${JSON.stringify(writes)}`);
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

async function run(scenario) {
  const m = mockFirestore(scenario);
  try {
    const { input, snapshot } = await computeCareStatusFromFirestore(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
    m.assertNoWrite();
    return { input, snapshot, calls: m.calls };
  } finally {
    m.restore();
  }
}

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── 1~15 시나리오 ────────────────────────────────────────────────────

check('1. activity + heartbeat fresh → NORMAL + online', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(snapshot.person.status, 'NORMAL');
  assert.equal(snapshot.person.reason, 'recent_activity');
  assert.equal(snapshot.device.health, 'online');
});

check('2. 오래된 activity + heartbeat fresh → CHECK + online', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(snapshot.person.status, 'CHECK');
  assert.equal(snapshot.person.reason, 'inactivity');
  assert.equal(snapshot.device.health, 'online');
});

check('3. 오래된 activity + heartbeat stale → CHECK + offline', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(40) },
  });
  assert.equal(snapshot.person.status, 'CHECK');
  assert.equal(snapshot.device.health, 'offline');
});

check('4. recent activity + heartbeat stale → NORMAL person + offline device (독립)', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(40) },
  });
  assert.equal(snapshot.person.status, 'NORMAL'); // CHECK 로 변조하지 않음
  assert.equal(snapshot.device.health, 'offline');
});

check('5. SOS + heartbeat fresh → EMERGENCY', async () => {
  const { snapshot } = await run({
    events: [
      { eventType: 'sos_triggered', occurredAt: iso(60) },
      { eventType: 'motion_detected', occurredAt: iso(90) },
    ],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(snapshot.person.status, 'EMERGENCY');
  assert.equal(snapshot.person.reason, 'sos');
});

check('6. SOS + heartbeat stale → EMERGENCY 최우선', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'sos_triggered', occurredAt: iso(60) }],
    device: { lastHeartbeatAt: iso(600) },
  });
  assert.equal(snapshot.person.status, 'EMERGENCY');
  assert.equal(snapshot.device.health, 'offline');
});

check('7. events 없음 → no_data (systemHealth unknown)', async () => {
  const { snapshot, input } = await run({ events: [], device: { lastHeartbeatAt: iso(8) } });
  assert.equal(input.hasAnyEvents, false);
  assert.equal(snapshot.person.reason, 'no_data');
  assert.equal(snapshot.person.systemHealth, 'unknown');
});

check('8. device 문서 없음 → unknown / no_device_doc', async () => {
  const { snapshot, input } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    deviceMissing: true,
  });
  assert.equal(input.deviceDocExists, false);
  assert.equal(snapshot.device.health, 'unknown');
  assert.equal(snapshot.device.reason, 'no_device_doc');
});

check('9. device 문서 존재 + heartbeat 없음 → unknown / no_heartbeat_capability', async () => {
  const { snapshot, input } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: {}, // 문서는 있으나 lastHeartbeatAt 없음
  });
  assert.equal(input.deviceDocExists, true);
  assert.equal(input.lastHeartbeatAt, undefined);
  assert.equal(snapshot.device.health, 'unknown');
  assert.equal(snapshot.device.reason, 'no_heartbeat_capability');
});

check('10. 최근 event 가 비활동(sos)이지만 이전에 activity 존재 → 올바른 activity 선택', async () => {
  const { input } = await run({
    events: [
      { eventType: 'sos_triggered', occurredAt: iso(10) }, // 가장 최근
      { eventType: 'medication_missed', occurredAt: iso(20) }, // 비활동
      { eventType: 'motion_detected', occurredAt: iso(35) }, // ← lastActivityAt
      { eventType: 'door_opened', occurredAt: iso(120) },
    ],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(input.lastActivityAt, iso(35));
  assert.equal(input.lastSosAt, iso(10));
});

check('11. 여러 activity 중 최신 선택', async () => {
  const { input } = await run({
    events: [
      { eventType: 'returned_home', occurredAt: iso(15) },
      { eventType: 'motion_detected', occurredAt: iso(45) },
      { eventType: 'watch_activity', occurredAt: iso(200) },
    ],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(input.lastActivityAt, iso(15));
});

check('12. 여러 SOS 중 최신 선택', async () => {
  const { input } = await run({
    events: [
      { eventType: 'sos_triggered', occurredAt: iso(30) },
      { eventType: 'sos_triggered', occurredAt: iso(300) },
    ],
    device: { lastHeartbeatAt: iso(8) },
  });
  assert.equal(input.lastSosAt, iso(30));
});

check('13. events 쿼리가 careRecipientId 로 제한된다 (structuredQuery.where)', async () => {
  const { calls } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  const q = calls.find((c) => c.u.includes(':runQuery'));
  assert.ok(q, ':runQuery 호출 없음');
  const filter = q.body.structuredQuery.where.fieldFilter;
  assert.equal(filter.field.fieldPath, 'careRecipientId');
  assert.equal(filter.op, 'EQUAL');
  assert.equal(filter.value.stringValue, CARE_ID);
  assert.equal(q.body.structuredQuery.orderBy[0].field.fieldPath, 'occurredAt');
  assert.equal(q.body.structuredQuery.orderBy[0].direction, 'DESCENDING');
  assert.equal(typeof q.body.structuredQuery.limit, 'number');
});

check('14. timestamp parsing — 잘못된 occurredAt 은 now 로 대체하지 않고 스킵', () => {
  assert.equal(toInstantIso('2026-09-07T02:05:00Z'), '2026-09-07T02:05:00.000Z');
  assert.equal(toInstantIso('not-a-date'), undefined);
  assert.equal(toInstantIso(''), undefined);
  assert.equal(toInstantIso(undefined), undefined);
  assert.equal(toInstantIso({ seconds: 123 }), undefined); // 문자열만 받는다

  const input = normalizeCareStatusInput(
    {
      events: [
        { eventType: 'motion_detected', occurredAt: 'garbage' }, // 스킵
        { eventType: 'door_opened', occurredAt: iso(50) }, // 채택
      ],
      device: { lastHeartbeatAt: 'also-garbage' },
    },
    THRESHOLDS,
  );
  assert.equal(input.lastActivityAt, iso(50));
  assert.equal(input.lastHeartbeatAt, undefined); // now 로 대체 안 함
});

check('15. threshold boundary — inactivity 정확히 180 → CHECK, heartbeat 정확히 25 → online', async () => {
  const { snapshot } = await run({
    events: [{ eventType: 'motion_detected', occurredAt: iso(180) }],
    device: { lastHeartbeatAt: iso(25) },
  });
  assert.equal(snapshot.person.status, 'CHECK');
  assert.equal(snapshot.device.health, 'online');
});

// ── ACTIVITY parity (STEP B-1.3) ─────────────────────────────────────

check('parity — 서버는 eventViews.ACTIVITY_EVENT_TYPES 를 그대로 공유한다 (watch/medication 포함)', () => {
  // ACTIVITY_EVENT_TYPES 에는 있고 DAILY_LIVING_ACTIVITY_EVENT_TYPES 에는 없는 것
  for (const t of ['watch_activity', 'medication_taken']) {
    assert.ok(ACTIVITY_EVENT_TYPES.has(t), `ACTIVITY_EVENT_TYPES 에 ${t} 있어야 함`);
    assert.ok(!DAILY_LIVING_ACTIVITY_EVENT_TYPES.has(t), `DAILY_LIVING 에 ${t} 없어야 함`);
  }
  // normalize 가 watch_activity 를 lastActivity 로 인정해야 한다 (서버는 넓은 쪽)
  const input = normalizeCareStatusInput(
    { events: [{ eventType: 'watch_activity', occurredAt: iso(10) }], device: null },
    THRESHOLDS,
  );
  assert.equal(input.lastActivityAt, iso(10));
});

check('parity — sos_triggered 는 activity 가 아니다 (lastActivityAt 로 잡히지 않음)', () => {
  const input = normalizeCareStatusInput(
    { events: [{ eventType: 'sos_triggered', occurredAt: iso(10) }], device: null },
    THRESHOLDS,
  );
  assert.equal(input.lastActivityAt, undefined);
  assert.equal(input.lastSosAt, iso(10));
  assert.equal(input.hasAnyEvents, true);
});

check('readCareStatusSource — READ 2회 (events 쿼리 + devices point read), WRITE 0', async () => {
  const m = mockFirestore({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  try {
    const src = await readCareStatusSource(ENV, { careRecipientId: CARE_ID, deviceId: DEVICE_ID });
    m.assertNoWrite();
    assert.equal(src.events.length, 1);
    assert.ok(src.device);
    const reads = m.calls.filter((c) => c.method === 'GET' || (c.method === 'POST' && c.u.includes(':runQuery')));
    assert.equal(reads.length, 2);
  } finally {
    m.restore();
  }
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.3 STEP B-1 — Firestore READ adapter smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
