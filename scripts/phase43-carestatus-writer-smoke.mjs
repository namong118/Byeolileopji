/**
 * Phase 4.3 STEP B-2 — careStatus 스냅샷 serialize + Firestore WRITE 스모크.
 *
 * 실행:  node scripts/phase43-carestatus-writer-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - serializeCareStatusSnapshot()  (src/services/careStatusSnapshotDoc.ts) — 순수
 *   - writeCareStatusSnapshot() / computeAndWriteCareStatusSnapshot()
 *       (server/cloudflare-worker/src/careStatusWriter.js)
 *   - 저장 경로가 deterministic (careStatus/{careRecipientId}, history 아님)
 *   - Firestore WRITE 성공 / 실패 path (실패가 호출자에게 전달됨)
 *   - B-1 READ→normalize→compute · client/server parity 회귀 없음
 *
 * 실제 Firestore 에 쓰지 않는다 — fetch mock 으로 REST 를 흉내낸다.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  fromFirestoreFields,
  toFirestoreFields,
} from '../server/cloudflare-worker/src/firestore.js';
import {
  writeCareStatusSnapshot,
  computeAndWriteCareStatusSnapshot,
  CARE_STATUS_COLLECTION,
} from '../server/cloudflare-worker/src/careStatusWriter.js';
import {
  serializeCareStatusSnapshot,
  CARE_STATUS_SNAPSHOT_SCHEMA_VERSION,
} from '../src/services/careStatusSnapshotDoc.ts';
import { computeCareStatusSnapshot } from '../src/services/careStatusSnapshot.ts';
import { computeCareStatusFromFirestore } from '../server/cloudflare-worker/src/careStatusReader.js';
import { deriveCareStatus } from '../src/services/careStatus.ts';
import { deriveDeviceHealth } from '../src/services/deviceHealth.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
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
const THRESHOLDS = {
  inactivityMinutes: 180,
  deviceOfflineMinutes: 25,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
};

/** 정규화된 입력 → 스냅샷 (compute 코어 직접 호출). */
function snapshotOf(partialInput, now = NOW) {
  return computeCareStatusSnapshot(
    {
      hasAnyEvents: true,
      deviceDocExists: true,
      thresholds: THRESHOLDS,
      ...partialInput,
    },
    now,
  );
}

/**
 * Firestore REST mock.
 *   PATCH …/careStatus/{id}?updateMask=…   → careStatus write (성공/실패 설정 가능)
 *   POST  …:runQuery                        → events 쿼리 (computeAndWrite… 용)
 *   GET   …/devices/{id}                    → device point read
 * 그 외 method/경로(POST /events, PATCH /devices …) → 테스트 실패용 599.
 */
function mockFirestore({ writeStatus = 200, events = [], device = {} } = {}) {
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

    if (u.includes(`/${CARE_STATUS_COLLECTION}/`) && method === 'PATCH') {
      if (writeStatus >= 200 && writeStatus < 300) {
        return new Response(JSON.stringify({ name: u.split('?')[0], fields: body.fields }), {
          status: writeStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ error: { code: writeStatus, message: 'permission denied' } }),
        { status: writeStatus, headers: { 'content-type': 'application/json' } },
      );
    }

    if (u.includes(':runQuery') && method === 'POST') {
      const rows = events.map((e) => ({
        document: {
          name: `projects/p/databases/(default)/documents/events/x${Math.random()}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            eventType: e.eventType,
            occurredAt: new Date(e.occurredAt),
          }),
        },
      }));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (u.includes('/devices/') && method === 'GET') {
      return new Response(
        JSON.stringify({
          name: `projects/p/databases/(default)/documents/devices/${DEVICE_ID}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            enabled: true,
            ...(device.lastEventAt ? { lastEventAt: new Date(device.lastEventAt) } : {}),
            ...(device.lastHeartbeatAt
              ? { lastHeartbeatAt: new Date(device.lastHeartbeatAt) }
              : {}),
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(`UNEXPECTED ${method} ${u}`, { status: 599 });
  };

  return {
    calls,
    writeCalls() {
      return calls.filter(
        (c) => c.u.includes(`/${CARE_STATUS_COLLECTION}/`) && c.method === 'PATCH',
      );
    },
    /** careStatus 외의 컬렉션에 쓰기(POST/PATCH/PUT/DELETE)가 없어야 한다. */
    assertOnlyCareStatusWrites() {
      const strayWrites = calls.filter(
        (c) =>
          !c.u.includes('oauth2.googleapis.com') && // OAuth 토큰 발급은 write 가 아니다
          (c.method === 'PATCH' || c.method === 'PUT' || c.method === 'DELETE' ||
            (c.method === 'POST' && !c.u.includes(':runQuery'))) &&
          !(c.u.includes(`/${CARE_STATUS_COLLECTION}/`) && c.method === 'PATCH'),
      );
      assert.equal(strayWrites.length, 0, `careStatus 외 write 발생: ${JSON.stringify(strayWrites)}`);
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** PATCH 호출의 body.fields 를 평문으로 되돌린다. */
function writtenDoc(call) {
  return fromFirestoreFields(call.body.fields);
}

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── 1. NORMAL 직렬화 정확성 ──────────────────────────────────────────
check('1. NORMAL compute → snapshot 직렬화 정확', () => {
  const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
  const doc = serializeCareStatusSnapshot(snap, CARE_ID);
  assert.equal(doc.careRecipientId, CARE_ID);
  assert.equal(doc.schemaVersion, CARE_STATUS_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(doc.status, 'NORMAL');
  assert.equal(doc.reason, 'recent_activity');
  assert.equal(doc.systemHealth, 'ok');
  assert.equal(doc.deviceHealth, 'online');
  assert.equal(doc.deviceHealthReason, 'heartbeat_fresh');
  assert.ok(doc.lastActivityAt instanceof Date);
  assert.equal(doc.lastActivityAt.toISOString(), iso(5));
  assert.equal(doc.emergencyEventAt, null); // NORMAL → sos 없음
  assert.equal(doc.computedAt.toISOString(), NOW.toISOString());
});

// ── 2. CHECK status/reason 유지 ──────────────────────────────────────
check('2. CHECK → status / reason 유지', () => {
  const snap = snapshotOf({ lastActivityAt: iso(240), lastHeartbeatAt: iso(8) });
  const doc = serializeCareStatusSnapshot(snap, CARE_ID);
  assert.equal(doc.status, 'CHECK');
  assert.equal(doc.reason, 'inactivity');
  assert.equal(typeof doc.minutesSinceActivity, 'number');
  assert.equal(doc.minutesSinceActivity, 240);
});

// ── 3. EMERGENCY 최우선 + emergencyEventAt ───────────────────────────
check('3. EMERGENCY → 최우선 상태 + emergencyEventAt 보존', () => {
  const snap = snapshotOf({
    lastSosAt: iso(60),
    lastActivityAt: iso(5),
    lastHeartbeatAt: iso(600), // 기기 offline 이어도
  });
  const doc = serializeCareStatusSnapshot(snap, CARE_ID);
  assert.equal(doc.status, 'EMERGENCY');
  assert.equal(doc.reason, 'sos');
  assert.ok(doc.emergencyEventAt instanceof Date);
  assert.equal(doc.emergencyEventAt.toISOString(), iso(60));
  assert.equal(doc.deviceHealth, 'offline'); // 기기 축은 독립적으로 기록
});

// ── 4. timestamp 필드 → Firestore write 가능 형태 ────────────────────
check('4. timestamp 필드 → toFirestoreFields 가 timestampValue 로 변환 (round-trip)', () => {
  const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
  const doc = serializeCareStatusSnapshot(snap, CARE_ID);
  const fields = toFirestoreFields(doc);
  assert.ok('timestampValue' in fields.lastActivityAt, 'lastActivityAt 이 timestampValue 여야');
  assert.ok('timestampValue' in fields.computedAt);
  assert.ok('nullValue' in fields.emergencyEventAt, '없는 시각은 nullValue');
  assert.ok('integerValue' in fields.schemaVersion);
  // 되돌리면 ISO 문자열
  const back = fromFirestoreFields(fields);
  assert.equal(back.lastActivityAt, iso(5));
  assert.equal(back.computedAt, NOW.toISOString());
});

// ── 5. undefined optional → null (garbage 저장 안 됨) ────────────────
check('5. undefined optional 필드 → null, "undefined"/NaN 저장 안 됨', () => {
  // no_data: 활동/ sos / heartbeat 전부 없음, device 문서도 없음
  const snap = snapshotOf({ hasAnyEvents: false, deviceDocExists: false });
  const doc = serializeCareStatusSnapshot(snap, CARE_ID);
  for (const k of [
    'lastActivityAt',
    'minutesSinceActivity',
    'emergencyEventAt',
    'deviceLastEventAt',
    'deviceLastHeartbeatAt',
    'deviceLastSeenAt',
    'deviceMinutesSinceSeen',
  ]) {
    assert.equal(doc[k], null, `${k} 는 null 이어야 함`);
  }
  // JSON 직렬화에 undefined 가 없어야 한다 (모든 키 존재)
  const json = JSON.stringify(doc);
  assert.ok(!json.includes('undefined'));
  assert.ok(!json.includes('NaN'));
  const fields = toFirestoreFields(doc);
  for (const k of Object.keys(doc)) {
    assert.ok(fields[k] && typeof fields[k] === 'object', `${k} field 누락`);
  }
});

// ── 6. careRecipientId → 문서 + 경로 ────────────────────────────────
check('6. careRecipientId → snapshot 문서 필드 + 저장 경로에 정확히 연결', async () => {
  const m = mockFirestore();
  try {
    const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
    const { path, doc } = await writeCareStatusSnapshot(ENV, CARE_ID, snap);
    assert.equal(doc.careRecipientId, CARE_ID);
    assert.equal(path, `${CARE_STATUS_COLLECTION}/${CARE_ID}`);
    const call = m.writeCalls()[0];
    assert.ok(call.u.includes(`/${CARE_STATUS_COLLECTION}/${CARE_ID}?`), '경로에 careRecipientId 없음');
    assert.equal(writtenDoc(call).careRecipientId, CARE_ID);
  } finally {
    m.restore();
  }
});

// ── 7. 같은 recipient 재계산 → 같은 deterministic 문서 target ─────────
check('7. 같은 recipient 재계산 → 동일 문서 경로 + 동일 직렬화 결과', async () => {
  const m = mockFirestore();
  try {
    const input = { lastActivityAt: iso(5), lastHeartbeatAt: iso(8) };
    const a = await writeCareStatusSnapshot(ENV, CARE_ID, snapshotOf(input));
    const b = await writeCareStatusSnapshot(ENV, CARE_ID, snapshotOf(input));
    assert.equal(a.path, b.path);
    assert.deepEqual(a.doc, b.doc, '같은 입력 → 같은 문서');
    // 다른 대상자는 다른 문서
    const c = await writeCareStatusSnapshot(ENV, 'other-recipient', snapshotOf(input));
    assert.notEqual(c.path, a.path);
  } finally {
    m.restore();
  }
});

// ── 8. 두 번 실행 → history 문서 중복 생성 아님 ──────────────────────
check('8. 두 번 write → 같은 문서 PATCH (auto-id POST 로 새 문서 안 쌓음)', async () => {
  const m = mockFirestore();
  try {
    const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
    await writeCareStatusSnapshot(ENV, CARE_ID, snap);
    await writeCareStatusSnapshot(ENV, CARE_ID, snap);
    const writes = m.writeCalls();
    assert.equal(writes.length, 2);
    for (const w of writes) {
      assert.equal(w.method, 'PATCH'); // POST(auto-id) 아님
      assert.ok(w.u.includes('updateMask.fieldPaths='), 'updateMask 로 전체 replace');
      assert.ok(
        w.u.endsWith(`/${CARE_STATUS_COLLECTION}/${CARE_ID}?`) ||
          w.u.includes(`/${CARE_STATUS_COLLECTION}/${CARE_ID}?updateMask`),
        '동일 문서 id',
      );
    }
    // events auto-id POST 가 없어야 한다 (OAuth 토큰 발급 POST 는 제외)
    assert.equal(
      m.calls.filter(
        (c) =>
          c.method === 'POST' &&
          !c.u.includes(':runQuery') &&
          !c.u.includes('oauth2.googleapis.com'),
      ).length,
      0,
    );
  } finally {
    m.restore();
  }
});

// ── 9. Firestore write 성공 path ────────────────────────────────────
check('9. Firestore write 성공 → { path, doc } 반환, throw 없음', async () => {
  const m = mockFirestore({ writeStatus: 200 });
  try {
    const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
    const res = await writeCareStatusSnapshot(ENV, CARE_ID, snap);
    assert.ok(res.path && res.doc);
    m.assertOnlyCareStatusWrites();
  } finally {
    m.restore();
  }
});

// ── 10. Firestore write 실패 path → 호출자에게 전달 ─────────────────
check('10. Firestore write 실패(403/500) → FirestoreError 가 호출자에게 throw', async () => {
  for (const status of [403, 500, 503]) {
    const m = mockFirestore({ writeStatus: status });
    try {
      const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
      await assert.rejects(
        () => writeCareStatusSnapshot(ENV, CARE_ID, snap),
        (err) => {
          assert.equal(err.name, 'FirestoreError');
          assert.equal(err.status, status);
          return true;
        },
        `status ${status} 는 throw 되어야 한다`,
      );
    } finally {
      m.restore();
    }
  }
});

check('10b. serialize 실패(careRecipientId 없음) → throw, write 시도 안 함', async () => {
  const m = mockFirestore();
  try {
    const snap = snapshotOf({ lastActivityAt: iso(5), lastHeartbeatAt: iso(8) });
    await assert.rejects(() => writeCareStatusSnapshot(ENV, '', snap), /careRecipientId required/);
    assert.equal(m.writeCalls().length, 0, 'serialize 실패 시 fetch 안 함');
  } finally {
    m.restore();
  }
});

// ── 11. B-1 READ→normalize→compute 회귀 없음 ────────────────────────
check('11. computeAndWriteCareStatusSnapshot — B-1 compute 결과와 동일 + WRITE 1회', async () => {
  const scenario = {
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  };
  // 순수 B-1 경로
  const m1 = mockFirestore(scenario);
  let b1;
  try {
    b1 = await computeCareStatusFromFirestore(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
  } finally {
    m1.restore();
  }
  // B-2 compute+write 경로
  const m2 = mockFirestore(scenario);
  try {
    const res = await computeAndWriteCareStatusSnapshot(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
    assert.deepEqual(res.snapshot, b1.snapshot, 'B-2 가 B-1 compute 결과를 바꾸지 않음');
    assert.deepEqual(res.input, b1.input);
    m2.assertOnlyCareStatusWrites();
    assert.equal(m2.writeCalls().length, 1, 'careStatus write 정확히 1회');
    // 저장된 문서가 스냅샷과 일치
    const doc = writtenDoc(m2.writeCalls()[0]);
    assert.equal(doc.status, b1.snapshot.person.status);
    assert.equal(doc.deviceHealth, b1.snapshot.device.health);
    assert.equal(doc.computedAt, b1.snapshot.computedAt);
  } finally {
    m2.restore();
  }
});

// ── 12. client/server parity 회귀 없음 ─────────────────────────────
check('12. parity — 직렬화된 status/reason 이 deriveCareStatus(앱 경로)와 일치', () => {
  const cfg = {
    inactivityCheckMinutes: 180,
    emergencyLookbackHours: 12,
    emergencyTtlHours: 12,
    deviceOfflineMinutes: 25,
    recomputeIntervalMs: 0,
    overrideTtlMs: 0,
  };
  const fixtures = [
    { lastActivityAt: iso(8), lastHeartbeatAt: iso(10) }, // NORMAL / online
    { lastActivityAt: iso(200), lastHeartbeatAt: iso(40) }, // CHECK / offline
    { lastSosAt: iso(90), lastActivityAt: iso(8), lastHeartbeatAt: iso(10) }, // EMERGENCY
  ];
  for (const fx of fixtures) {
    const person = deriveCareStatus({
      lastActivityAt: fx.lastActivityAt,
      lastSosAt: fx.lastSosAt,
      totalEventCount: 5,
      config: cfg,
      now: NOW,
    });
    const device = deriveDeviceHealth({
      deviceDocExists: true,
      lastHeartbeatAt: fx.lastHeartbeatAt,
      config: cfg,
      now: NOW,
    });
    const doc = serializeCareStatusSnapshot(snapshotOf(fx), CARE_ID);
    assert.equal(doc.status, person.status);
    assert.equal(doc.reason, person.reason);
    assert.equal(doc.systemHealth, person.systemHealth);
    assert.equal(doc.deviceHealth, device.health);
    assert.equal(doc.deviceHealthReason, device.reason);
  }
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.3 STEP B-2 — careStatus snapshot serialize + write smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
