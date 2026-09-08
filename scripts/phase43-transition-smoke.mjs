/**
 * Phase 4.3 STEP B-3 — careStatus 전환 감지 스모크.
 *
 * 실행:  node scripts/phase43-transition-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - deriveCareStatusTransition()  (src/services/careStatusTransition.ts) — 순수
 *       · 사람 축 / 기기 축 독립 감지
 *       · reason 변화만으로는 전환 아님
 *       · 이전 스냅샷 없음 → isInitial / 전환 없음 (baseline seed)
 *       · 두 축 동시 변화 → 둘 다 기록 (EMERGENCY 라고 device 축 삭제 안 함)
 *   - parseCareStatusDoc() / readCareStatusDoc()  (careStatusWriter.js)
 *       · 404 → null, 403/500 → throw, malformed status/deviceHealth → throw
 *   - computeCompareAndWriteCareStatusSnapshot()  — previous READ + compute + detect + WRITE
 *       · 전환은 WRITE 전에 계산 / WRITE 실패 시 transition 반환 안 함
 *
 * FCM / cron / history write / 실제 Firestore write 없음 — fetch mock.
 */

import assert from 'node:assert/strict';

import { toFirestoreFields, fromFirestoreFields } from '../server/cloudflare-worker/src/firestore.js';
import {
  deriveCareStatusTransition,
  isCareStatus,
  isDeviceHealth,
  CARE_STATUS_VALUES,
  DEVICE_HEALTH_VALUES,
} from '../src/services/careStatusTransition.ts';
import {
  parseCareStatusDoc,
  readCareStatusDoc,
  computeCompareAndWriteCareStatusSnapshot,
  computeAndWriteCareStatusSnapshot,
  CARE_STATUS_COLLECTION,
} from '../server/cloudflare-worker/src/careStatusWriter.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
const ENV = { FIREBASE_PROJECT_ID: 'byeolileopji' };
const THRESHOLDS = {
  inactivityMinutes: 180,
  deviceOfflineMinutes: 25,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
};

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

/** { status, deviceHealth, reason?, deviceHealthReason? } → careStatus 문서 fields (Firestore REST) */
function careStatusFields(o) {
  return toFirestoreFields({
    careRecipientId: CARE_ID,
    schemaVersion: o.schemaVersion ?? 1,
    status: o.status,
    reason: o.reason ?? 'recent_activity',
    systemHealth: 'ok',
    deviceHealth: o.deviceHealth,
    deviceHealthReason: o.deviceHealthReason ?? 'heartbeat_fresh',
    computedAt: o.computedAt ? new Date(o.computedAt) : new Date(iso(10)),
  });
}

// ═════════════════════════════════════════════════════════════════════
//  A. 순수 detector — 사람 축 (STEP B-3.12)
// ═════════════════════════════════════════════════════════════════════

check('1. previous 없음(null) → NORMAL: isInitial, 전환 없음, changed=false', () => {
  for (const prev of [null, undefined]) {
    const r = deriveCareStatusTransition(prev, { status: 'NORMAL', deviceHealth: 'online' });
    assert.equal(r.isInitial, true);
    assert.equal(r.personTransition, null);
    assert.equal(r.deviceTransition, null);
    assert.equal(r.changed, false);
  }
  // 초기 스냅샷이 EMERGENCY 여도 baseline (전환 알림 아님) — Phase 4.4 재검토 대상
  const emg = deriveCareStatusTransition(null, { status: 'EMERGENCY', deviceHealth: 'offline' });
  assert.deepEqual(emg, {
    isInitial: true,
    personTransition: null,
    deviceTransition: null,
    changed: false,
  });
});

check('2. NORMAL → NORMAL: 전환 없음, isInitial=false', () => {
  const r = deriveCareStatusTransition(
    { status: 'NORMAL', deviceHealth: 'online' },
    { status: 'NORMAL', deviceHealth: 'online' },
  );
  assert.equal(r.isInitial, false);
  assert.equal(r.personTransition, null);
  assert.equal(r.deviceTransition, null);
  assert.equal(r.changed, false);
});

check('3-8. 모든 사람 상태 pair — from!==to 일 때만 personTransition', () => {
  for (const from of CARE_STATUS_VALUES) {
    for (const to of CARE_STATUS_VALUES) {
      const r = deriveCareStatusTransition(
        { status: from, deviceHealth: 'online' },
        { status: to, deviceHealth: 'online' },
      );
      if (from === to) {
        assert.equal(r.personTransition, null, `${from}→${to} 는 전환 아님`);
        assert.equal(r.changed, false);
      } else {
        assert.deepEqual(r.personTransition, { from, to }, `${from}→${to}`);
        assert.equal(r.deviceTransition, null, '기기 축은 안 건드림');
        assert.equal(r.changed, true);
      }
    }
  }
});

check('9. CHECK/reason A → CHECK/reason B: 전환 아님 (reason 은 identity 아님)', () => {
  // 전체 문서 형태(다른 reason)로 넘겨도 status 만 본다
  const prev = { status: 'CHECK', reason: 'inactivity', deviceHealth: 'offline', deviceHealthReason: 'heartbeat_stale' };
  const next = { status: 'CHECK', reason: 'no_data', deviceHealth: 'offline', deviceHealthReason: 'no_heartbeat_capability' };
  const r = deriveCareStatusTransition(prev, next);
  assert.equal(r.personTransition, null);
  assert.equal(r.deviceTransition, null);
  assert.equal(r.changed, false);
});

// ═════════════════════════════════════════════════════════════════════
//  B. 순수 detector — 기기 축 (STEP B-3.13)
// ═════════════════════════════════════════════════════════════════════

check('10-16. 모든 기기 상태 pair — 사람 상태 동일해도 device 전환 독립 감지', () => {
  for (const from of DEVICE_HEALTH_VALUES) {
    for (const to of DEVICE_HEALTH_VALUES) {
      const r = deriveCareStatusTransition(
        { status: 'NORMAL', deviceHealth: from },
        { status: 'NORMAL', deviceHealth: to }, // 사람 상태 NORMAL 고정
      );
      assert.equal(r.personTransition, null, '사람 상태 안 바뀜');
      if (from === to) {
        assert.equal(r.deviceTransition, null, `${from}→${to} 는 전환 아님`);
        assert.equal(r.changed, false);
      } else {
        assert.deepEqual(r.deviceTransition, { from, to }, `${from}→${to}`);
        assert.equal(r.changed, true);
      }
    }
  }
});

// ═════════════════════════════════════════════════════════════════════
//  C. 두 축 동시 변화 (STEP B-3.14)
// ═════════════════════════════════════════════════════════════════════

check('17. NORMAL+online → CHECK+offline: 두 전환 모두 기록', () => {
  const r = deriveCareStatusTransition(
    { status: 'NORMAL', deviceHealth: 'online' },
    { status: 'CHECK', deviceHealth: 'offline' },
  );
  assert.deepEqual(r.personTransition, { from: 'NORMAL', to: 'CHECK' });
  assert.deepEqual(r.deviceTransition, { from: 'online', to: 'offline' });
  assert.equal(r.changed, true);
});

check('18. NORMAL+online → EMERGENCY+offline: EMERGENCY 여도 device 전환 삭제 안 함', () => {
  const r = deriveCareStatusTransition(
    { status: 'NORMAL', deviceHealth: 'online' },
    { status: 'EMERGENCY', deviceHealth: 'offline' },
  );
  assert.deepEqual(r.personTransition, { from: 'NORMAL', to: 'EMERGENCY' });
  assert.deepEqual(r.deviceTransition, { from: 'online', to: 'offline' });
  assert.equal(r.changed, true);
});

check('19. 순수성 — 같은 입력 → 같은 출력, 입력 객체 변조 없음', () => {
  const prev = { status: 'NORMAL', deviceHealth: 'online' };
  const next = { status: 'CHECK', deviceHealth: 'online' };
  const a = deriveCareStatusTransition(prev, next);
  const b = deriveCareStatusTransition(prev, next);
  assert.deepEqual(a, b);
  assert.deepEqual(prev, { status: 'NORMAL', deviceHealth: 'online' });
  assert.deepEqual(next, { status: 'CHECK', deviceHealth: 'online' });
});

check('20. isCareStatus / isDeviceHealth 런타임 가드', () => {
  assert.ok(isCareStatus('NORMAL') && isCareStatus('CHECK') && isCareStatus('EMERGENCY'));
  assert.ok(!isCareStatus('normal') && !isCareStatus('') && !isCareStatus(undefined) && !isCareStatus(1));
  assert.ok(isDeviceHealth('online') && isDeviceHealth('offline') && isDeviceHealth('unknown'));
  assert.ok(!isDeviceHealth('ONLINE') && !isDeviceHealth(null) && !isDeviceHealth('dead'));
});

// ═════════════════════════════════════════════════════════════════════
//  D. parseCareStatusDoc (STEP B-3.8 / .15)
// ═════════════════════════════════════════════════════════════════════

check('21. 정상 문서 → status/deviceHealth/reason/metadata 파싱', () => {
  const parsed = parseCareStatusDoc(
    careStatusFields({ status: 'CHECK', reason: 'inactivity', deviceHealth: 'offline', deviceHealthReason: 'heartbeat_stale' }),
  );
  assert.equal(parsed.status, 'CHECK');
  assert.equal(parsed.deviceHealth, 'offline');
  assert.equal(parsed.reason, 'inactivity');
  assert.equal(parsed.deviceHealthReason, 'heartbeat_stale');
  assert.equal(parsed.careRecipientId, CARE_ID);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(typeof parsed.computedAt, 'string');
});

check('22. malformed status → FirestoreError(422), 조용히 NORMAL 대체 안 함', () => {
  assert.throws(
    () => parseCareStatusDoc(toFirestoreFields({ status: 'FINE', deviceHealth: 'online' })),
    (e) => e.name === 'FirestoreError' && e.status === 422,
  );
  assert.throws(
    () => parseCareStatusDoc(toFirestoreFields({ deviceHealth: 'online' })), // status 없음
    (e) => e.name === 'FirestoreError' && e.status === 422,
  );
});

check('23. malformed deviceHealth → FirestoreError(422)', () => {
  assert.throws(
    () => parseCareStatusDoc(toFirestoreFields({ status: 'NORMAL', deviceHealth: 'dead' })),
    (e) => e.name === 'FirestoreError' && e.status === 422,
  );
});

check('24. schemaVersion 불일치(999) + 유효 enum → 파싱 OK (forward-compatible)', () => {
  const parsed = parseCareStatusDoc(
    careStatusFields({ status: 'NORMAL', deviceHealth: 'online', schemaVersion: 999 }),
  );
  assert.equal(parsed.status, 'NORMAL');
  assert.equal(parsed.schemaVersion, 999);
});

check('25. computedAt 없음 → 파싱 OK (identity 아님)', () => {
  const parsed = parseCareStatusDoc(toFirestoreFields({ status: 'NORMAL', deviceHealth: 'unknown' }));
  assert.equal(parsed.status, 'NORMAL');
  assert.equal(parsed.computedAt, undefined);
});

// ═════════════════════════════════════════════════════════════════════
//  E. Firestore REST mock — pipeline
// ═════════════════════════════════════════════════════════════════════

/**
 * stateful mock.
 *   GET  …/careStatus/{id}     → careStatusState (null | fields | {httpError})
 *   POST …:runQuery            → events
 *   GET  …/devices/{id}        → device
 *   PATCH …/careStatus/{id}    → write 성공/실패 (writeStatus), 성공 시 careStatusState 갱신
 */
function mockFirestore({ careStatusState = null, events = [], device = {}, writeStatus = 200 } = {}) {
  let current = careStatusState; // null | { fields } | { httpError: number }
  const calls = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ u, method, body });

    const isCareStatusUrl = u.includes(`/${CARE_STATUS_COLLECTION}/`);

    if (isCareStatusUrl && method === 'GET') {
      if (current && current.httpError) {
        return new Response(JSON.stringify({ error: { code: current.httpError } }), {
          status: current.httpError,
        });
      }
      if (current == null) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ name: u.split('?')[0], fields: current.fields }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (isCareStatusUrl && method === 'PATCH') {
      if (writeStatus >= 200 && writeStatus < 300) {
        current = { fields: body.fields }; // 다음 GET 이 이걸 previous 로 본다
        return new Response(JSON.stringify({ name: u.split('?')[0], fields: body.fields }), {
          status: writeStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { code: writeStatus } }), { status: writeStatus });
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
            ...(device.lastHeartbeatAt ? { lastHeartbeatAt: new Date(device.lastHeartbeatAt) } : {}),
            ...(device.lastEventAt ? { lastEventAt: new Date(device.lastEventAt) } : {}),
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(`UNEXPECTED ${method} ${u}`, { status: 599 });
  };

  return {
    calls,
    patchCalls() {
      return calls.filter((c) => c.u.includes(`/${CARE_STATUS_COLLECTION}/`) && c.method === 'PATCH');
    },
    currentDoc() {
      return current && current.fields ? fromFirestoreFields(current.fields) : null;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

check('26. readCareStatusDoc — GET 200 → 파싱 객체 / 404 → null', async () => {
  const m1 = mockFirestore({ careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) } });
  try {
    const doc = await readCareStatusDoc(ENV, CARE_ID);
    assert.equal(doc.status, 'NORMAL');
    assert.equal(doc.deviceHealth, 'online');
  } finally {
    m1.restore();
  }
  const m2 = mockFirestore({ careStatusState: null });
  try {
    assert.equal(await readCareStatusDoc(ENV, CARE_ID), null); // 초기 상태
  } finally {
    m2.restore();
  }
});

check('27. readCareStatusDoc — 403 / 500 → throw (null 로 삼키지 않음)', async () => {
  for (const status of [403, 500]) {
    const m = mockFirestore({ careStatusState: { httpError: status } });
    try {
      await assert.rejects(
        () => readCareStatusDoc(ENV, CARE_ID),
        (e) => e.name === 'FirestoreError' && e.status === status,
      );
    } finally {
      m.restore();
    }
  }
});

check('28. pipeline — previous NORMAL/online, 새 계산 CHECK/offline → 두 전환 + PATCH 1회', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }], // 240분 전 → inactivity CHECK
    device: { lastHeartbeatAt: iso(40) }, // 40분 전 → offline
  });
  try {
    const res = await computeCompareAndWriteCareStatusSnapshot(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
    assert.equal(res.snapshot.person.status, 'CHECK');
    assert.equal(res.snapshot.device.health, 'offline');
    assert.deepEqual(res.transition.personTransition, { from: 'NORMAL', to: 'CHECK' });
    assert.deepEqual(res.transition.deviceTransition, { from: 'online', to: 'offline' });
    assert.equal(res.transition.isInitial, false);
    assert.equal(res.transition.changed, true);
    assert.equal(m.patchCalls().length, 1, 'careStatus PATCH 정확히 1회');
    // 저장된 문서가 새 스냅샷과 일치
    assert.equal(m.currentDoc().status, 'CHECK');
    assert.equal(m.currentDoc().deviceHealth, 'offline');
  } finally {
    m.restore();
  }
});

check('29. pipeline — 같은 fixture 재실행: 두 번째는 previous=CHECK/offline → 전환 없음', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(40) },
  });
  try {
    const opts = { careRecipientId: CARE_ID, deviceId: DEVICE_ID, thresholds: THRESHOLDS, now: NOW };
    const first = await computeCompareAndWriteCareStatusSnapshot(ENV, opts);
    assert.equal(first.transition.changed, true);

    const second = await computeCompareAndWriteCareStatusSnapshot(ENV, opts);
    assert.equal(second.transition.isInitial, false);
    assert.equal(second.transition.personTransition, null);
    assert.equal(second.transition.deviceTransition, null);
    assert.equal(second.transition.changed, false);
    assert.equal(m.patchCalls().length, 2, '두 번째도 idempotent PATCH (전환 없어도 write)');
  } finally {
    m.restore();
  }
});

check('30. pipeline — previous 없음(404) + 새 계산 EMERGENCY → isInitial, 전환 없음, write 1회', async () => {
  const m = mockFirestore({
    careStatusState: null,
    events: [{ eventType: 'sos_triggered', occurredAt: iso(60) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const res = await computeCompareAndWriteCareStatusSnapshot(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
    assert.equal(res.snapshot.person.status, 'EMERGENCY');
    assert.equal(res.previous, null);
    assert.equal(res.transition.isInitial, true);
    assert.equal(res.transition.personTransition, null);
    assert.equal(res.transition.deviceTransition, null);
    assert.equal(res.transition.changed, false);
    assert.equal(m.patchCalls().length, 1, '초기 스냅샷도 write 는 한다');
    assert.equal(m.currentDoc().status, 'EMERGENCY');
  } finally {
    m.restore();
  }
});

check('31. pipeline — WRITE 실패(500) → throw, transition 결과 반환 안 함', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(40) },
    writeStatus: 500,
  });
  try {
    await assert.rejects(
      () =>
        computeCompareAndWriteCareStatusSnapshot(ENV, {
          careRecipientId: CARE_ID,
          deviceId: DEVICE_ID,
          thresholds: THRESHOLDS,
          now: NOW,
        }),
      (e) => e.name === 'FirestoreError' && e.status === 500,
    );
  } finally {
    m.restore();
  }
});

check('32. pipeline — previous READ 실패(403) → WRITE 전에 throw (PATCH 0회)', async () => {
  const m = mockFirestore({
    careStatusState: { httpError: 403 },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    await assert.rejects(
      () =>
        computeCompareAndWriteCareStatusSnapshot(ENV, {
          careRecipientId: CARE_ID,
          deviceId: DEVICE_ID,
          thresholds: THRESHOLDS,
          now: NOW,
        }),
      (e) => e.name === 'FirestoreError' && e.status === 403,
    );
    assert.equal(m.patchCalls().length, 0, 'previous READ 실패면 write 안 함');
  } finally {
    m.restore();
  }
});

check('33. pipeline — malformed previous 문서(status 깨짐) → throw (조용히 NORMAL 대체 안 함)', async () => {
  const m = mockFirestore({
    careStatusState: { fields: toFirestoreFields({ status: 'WEIRD', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    await assert.rejects(
      () =>
        computeCompareAndWriteCareStatusSnapshot(ENV, {
          careRecipientId: CARE_ID,
          deviceId: DEVICE_ID,
          thresholds: THRESHOLDS,
          now: NOW,
        }),
      (e) => e.name === 'FirestoreError' && e.status === 422,
    );
    assert.equal(m.patchCalls().length, 0);
  } finally {
    m.restore();
  }
});

// ═════════════════════════════════════════════════════════════════════
//  F. B-2 회귀 — computeAndWriteCareStatusSnapshot 은 그대로 동작
// ═════════════════════════════════════════════════════════════════════

check('34. B-2 회귀 — computeAndWriteCareStatusSnapshot 정상 (transition 없이 write)', async () => {
  const m = mockFirestore({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  try {
    const res = await computeAndWriteCareStatusSnapshot(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: NOW,
    });
    assert.equal(res.snapshot.person.status, 'NORMAL');
    assert.equal(res.transition, undefined, 'B-2 함수는 transition 안 만든다');
    assert.equal(m.patchCalls().length, 1);
  } finally {
    m.restore();
  }
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.3 STEP B-3 — careStatus transition detection smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
