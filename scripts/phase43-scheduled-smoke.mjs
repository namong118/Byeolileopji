/**
 * Phase 4.3 STEP B-4 — Cloudflare Cron scheduled() careStatus 파이프라인 스모크.
 *
 * 실행:  node scripts/phase43-scheduled-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - wrangler.toml [triggers] crons = ["*​/10 * * * *"]
 *   - index.js default export 에 scheduled() 추가, fetch() 는 그대로
 *   - scheduled() → runScheduledCareStatus() → computeCompareAndWriteCareStatusSnapshot() (B-3)
 *   - server threshold 는 Worker env 독립 (EXPO_PUBLIC_* 의존 없음)
 *   - 반복 실행 시 같은 상태에서 전환 중복 없음, 실패를 성공으로 삼키지 않음
 *
 * FCM / cron 실제 등록 / production deploy / 실제 Firestore write 없음 — fetch mock.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import workerHandler from '../server/cloudflare-worker/src/index.js';
import {
  runScheduledCareStatus,
  resolveServerThresholds,
  resolveScheduledTargets,
  DEFAULT_SERVER_THRESHOLDS,
} from '../server/cloudflare-worker/src/scheduled.js';
import {
  computeAndWriteCareStatusSnapshot,
  CARE_STATUS_COLLECTION,
} from '../server/cloudflare-worker/src/careStatusWriter.js';
import { toFirestoreFields, fromFirestoreFields } from '../server/cloudflare-worker/src/firestore.js';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
const ENV = {
  FIREBASE_PROJECT_ID: 'byeolileopji',
  CARE_RECIPIENT_ID: CARE_ID,
  DEVICE_ID,
};

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

function careStatusFields(o) {
  return toFirestoreFields({
    careRecipientId: CARE_ID,
    schemaVersion: 1,
    status: o.status,
    reason: o.reason ?? 'recent_activity',
    systemHealth: 'ok',
    deviceHealth: o.deviceHealth,
    deviceHealthReason: o.deviceHealthReason ?? 'heartbeat_fresh',
    computedAt: new Date(iso(10)),
  });
}

/**
 * stateful Firestore REST mock (phase43-transition-smoke 의 것과 동일 패턴 + events/device 변경 가능).
 */
function mockFirestore({
  careStatusState = null,
  events = [],
  device = {},
  writeStatus = 200,
  queryStatus = 200,
} = {}) {
  let current = careStatusState; // null | { fields } | { httpError }
  let currentEvents = events;
  let currentDevice = device;
  let currentQueryStatus = queryStatus;
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
        current = { fields: body.fields };
        return new Response(JSON.stringify({ name: u.split('?')[0], fields: body.fields }), {
          status: writeStatus,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { code: writeStatus } }), { status: writeStatus });
    }

    if (u.includes(':runQuery') && method === 'POST') {
      if (currentQueryStatus >= 400) {
        return new Response(JSON.stringify({ error: { code: currentQueryStatus } }), {
          status: currentQueryStatus,
        });
      }
      const rows = currentEvents.map((e) => ({
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
            ...(currentDevice.lastHeartbeatAt
              ? { lastHeartbeatAt: new Date(currentDevice.lastHeartbeatAt) }
              : {}),
            ...(currentDevice.lastEventAt
              ? { lastEventAt: new Date(currentDevice.lastEventAt) }
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
    patchCalls() {
      return calls.filter((c) => c.u.includes(`/${CARE_STATUS_COLLECTION}/`) && c.method === 'PATCH');
    },
    currentDoc() {
      return current && current.fields ? fromFirestoreFields(current.fields) : null;
    },
    setEvents(e) {
      currentEvents = e;
    },
    setDevice(d) {
      currentDevice = d;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

// ═════════════════════════════════════════════════════════════════════
//  A. wrangler.toml Cron Trigger
// ═════════════════════════════════════════════════════════════════════

const wranglerToml = fs.readFileSync(
  new URL('../server/cloudflare-worker/wrangler.toml', import.meta.url),
  'utf8',
);

check('1. wrangler.toml — [triggers] crons = ["*/10 * * * *"]', () => {
  assert.match(wranglerToml, /\[triggers\]/, '[triggers] section 없음');
  assert.match(
    wranglerToml,
    /crons\s*=\s*\[\s*"\*\/10 \* \* \* \*"\s*\]/,
    '10분 cron expression 없음',
  );
});

check('2. wrangler.toml — 대상 id + 서버 threshold vars (비밀 아님)', () => {
  assert.match(wranglerToml, /CARE_RECIPIENT_ID\s*=\s*"dev-care-recipient"/);
  assert.match(wranglerToml, /DEVICE_ID\s*=\s*"dev-device-livingroom"/);
  assert.match(wranglerToml, /INACTIVITY_CHECK_MINUTES\s*=\s*"180"/);
  assert.match(wranglerToml, /DEVICE_OFFLINE_MINUTES\s*=\s*"25"/);
});

check('3. wrangler.toml — secret 값 없음 (DEVICE_KEY / private key / token)', () => {
  assert.doesNotMatch(wranglerToml, /DEVICE_KEY\s*=\s*"/, 'DEVICE_KEY 에 값이 할당됨');
  assert.doesNotMatch(wranglerToml, /BEGIN [A-Z ]*PRIVATE KEY/);
  assert.doesNotMatch(wranglerToml, /(access_token|refresh_token|service_account|password)\s*=/i);
});

// ═════════════════════════════════════════════════════════════════════
//  B. index.js handler export
// ═════════════════════════════════════════════════════════════════════

check('4. index.js — default export 에 scheduled() 추가 + fetch() 유지', () => {
  assert.equal(typeof workerHandler.fetch, 'function', 'fetch 핸들러 사라짐');
  assert.equal(typeof workerHandler.scheduled, 'function', 'scheduled 핸들러 없음');
});

check('5. fetch 핸들러 회귀 없음 — GET /health → { ok: true }', async () => {
  const res = await workerHandler.fetch(
    new Request('https://w.example/health', { method: 'GET' }),
    ENV,
  );
  assert.equal(res.status, 200);
  const bodyJson = await res.json();
  assert.equal(bodyJson.ok, true);
  assert.equal(bodyJson.endpoint, '/ingest-device-event');
});

check('6. fetch 핸들러 회귀 없음 — 알 수 없는 경로 → 404', async () => {
  const res = await workerHandler.fetch(
    new Request('https://w.example/nope', { method: 'GET' }),
    ENV,
  );
  assert.equal(res.status, 404);
});

// ═════════════════════════════════════════════════════════════════════
//  C. server threshold — Worker env 독립
// ═════════════════════════════════════════════════════════════════════

check('7. resolveServerThresholds — 기본값 = 앱 production default (180/25/12/12)', () => {
  const t = resolveServerThresholds({});
  assert.deepEqual(t, {
    inactivityMinutes: 180,
    deviceOfflineMinutes: 25,
    emergencyLookbackHours: 12,
    emergencyTtlHours: 12,
  });
  assert.equal(DEFAULT_SERVER_THRESHOLDS.inactivityMinutes, 180);
  assert.equal(DEFAULT_SERVER_THRESHOLDS.deviceOfflineMinutes, 25);
});

check('8. resolveServerThresholds — EXPO_PUBLIC_* 을 절대 참조하지 않음', () => {
  const saved = process.env.EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES;
  process.env.EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES = '2'; // 앱 개발용 override
  try {
    const t = resolveServerThresholds({}); // env 로 아무것도 안 줌
    assert.equal(t.inactivityMinutes, 180, 'EXPO_PUBLIC override 를 주워오면 안 된다');
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES;
    else process.env.EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES = saved;
  }
});

check('9. resolveServerThresholds — Worker env var 로 override 가능 (문자열/숫자)', () => {
  const t = resolveServerThresholds({
    INACTIVITY_CHECK_MINUTES: '90',
    DEVICE_OFFLINE_MINUTES: 30,
    EMERGENCY_TTL_HOURS: '6',
  });
  assert.equal(t.inactivityMinutes, 90);
  assert.equal(t.deviceOfflineMinutes, 30);
  assert.equal(t.emergencyTtlHours, 6);
  assert.equal(t.emergencyLookbackHours, 12); // 미지정 → 기본값
  // 잘못된 값 → 기본값 (0/음수/문자)
  const bad = resolveServerThresholds({ INACTIVITY_CHECK_MINUTES: 'abc', DEVICE_OFFLINE_MINUTES: '-5' });
  assert.equal(bad.inactivityMinutes, 180);
  assert.equal(bad.deviceOfflineMinutes, 25);
});

check('10. resolveScheduledTargets — 단일 dev recipient (env), 누락 시 throw', () => {
  assert.deepEqual(resolveScheduledTargets(ENV), [
    { careRecipientId: CARE_ID, deviceId: DEVICE_ID },
  ]);
  assert.throws(() => resolveScheduledTargets({ DEVICE_ID }), /CARE_RECIPIENT_ID/);
  assert.throws(() => resolveScheduledTargets({ CARE_RECIPIENT_ID: CARE_ID }), /DEVICE_ID/);
});

// ═════════════════════════════════════════════════════════════════════
//  D. runScheduledCareStatus — B-3 pipeline 재사용
// ═════════════════════════════════════════════════════════════════════

const silent = { log() {} };

check('11. initial baseline — careStatus 없음(404) → changed=false, snapshot write 1회', async () => {
  const m = mockFirestore({
    careStatusState: null,
    events: [{ eventType: 'sos_triggered', occurredAt: iso(30) }], // EMERGENCY
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const out = await runScheduledCareStatus(ENV, { now: NOW, logger: silent });
    const r = out.results[0];
    assert.equal(r.careRecipientId, CARE_ID);
    assert.equal(r.status, 'EMERGENCY');
    assert.equal(r.isInitial, true);
    assert.equal(r.changed, false);
    assert.equal(r.personTransition, null);
    assert.equal(r.deviceTransition, null);
    assert.equal(m.patchCalls().length, 1);
    assert.equal(m.currentDoc().status, 'EMERGENCY');
  } finally {
    m.restore();
  }
});

check('12. NORMAL → NORMAL → CHECK → CHECK (10분 cron 반복) — 전환 중복 없음', async () => {
  const m = mockFirestore({
    careStatusState: null,
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    // tick 1 — 초기, NORMAL
    let r = (await runScheduledCareStatus(ENV, { now: NOW, logger: silent })).results[0];
    assert.equal(r.status, 'NORMAL');
    assert.equal(r.isInitial, true);
    assert.equal(r.changed, false);

    // tick 2 (+10분) — 여전히 활동 최근, NORMAL → NORMAL
    m.setEvents([{ eventType: 'motion_detected', occurredAt: iso(5) }]);
    r = (await runScheduledCareStatus(ENV, { now: new Date(NOW.getTime() + 10 * 60_000), logger: silent })).results[0];
    assert.equal(r.status, 'NORMAL');
    assert.equal(r.isInitial, false);
    assert.equal(r.changed, false, 'NORMAL 유지 중엔 전환 없음');

    // tick 3 (+200분) — 활동 오래됨 → CHECK. 전환 1회.
    const t3 = new Date(NOW.getTime() + 200 * 60_000);
    m.setEvents([{ eventType: 'motion_detected', occurredAt: new Date(t3.getTime() - 250 * 60_000).toISOString() }]);
    r = (await runScheduledCareStatus(ENV, { now: t3, logger: silent })).results[0];
    assert.equal(r.status, 'CHECK');
    assert.equal(r.changed, true);
    assert.deepEqual(r.personTransition, { from: 'NORMAL', to: 'CHECK' });

    // tick 4 (+210분) — 여전히 CHECK → CHECK. 전환 중복 없음.
    const t4 = new Date(NOW.getTime() + 210 * 60_000);
    m.setEvents([{ eventType: 'motion_detected', occurredAt: new Date(t4.getTime() - 260 * 60_000).toISOString() }]);
    r = (await runScheduledCareStatus(ENV, { now: t4, logger: silent })).results[0];
    assert.equal(r.status, 'CHECK');
    assert.equal(r.changed, false, 'CHECK 유지 중엔 전환 없음');

    assert.equal(m.patchCalls().length, 4, '매 tick 마다 idempotent write');
  } finally {
    m.restore();
  }
});

check('13. NORMAL → CHECK — person transition 정확', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    const r = (await runScheduledCareStatus(ENV, { now: NOW, logger: silent })).results[0];
    assert.equal(r.status, 'CHECK');
    assert.deepEqual(r.personTransition, { from: 'NORMAL', to: 'CHECK' });
    assert.equal(r.deviceTransition, null);
    assert.equal(r.changed, true);
  } finally {
    m.restore();
  }
});

check('14. online → offline — device transition 정확 (사람 상태 안 바뀜)', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }], // NORMAL 유지
    device: { lastHeartbeatAt: iso(40) }, // offline
  });
  try {
    const r = (await runScheduledCareStatus(ENV, { now: NOW, logger: silent })).results[0];
    assert.equal(r.status, 'NORMAL');
    assert.equal(r.personTransition, null);
    assert.deepEqual(r.deviceTransition, { from: 'online', to: 'offline' });
    assert.equal(r.changed, true);
  } finally {
    m.restore();
  }
});

check('15. 사람 + 기기 동시 transition 유지', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }], // CHECK
    device: { lastHeartbeatAt: iso(40) }, // offline
  });
  try {
    const r = (await runScheduledCareStatus(ENV, { now: NOW, logger: silent })).results[0];
    assert.deepEqual(r.personTransition, { from: 'NORMAL', to: 'CHECK' });
    assert.deepEqual(r.deviceTransition, { from: 'online', to: 'offline' });
    assert.equal(r.changed, true);
  } finally {
    m.restore();
  }
});

check('16. device offline threshold semantics 유지 — Cron 10분과 무관', async () => {
  // heartbeat 20분 전: 25분 threshold → 여전히 online. (Cron 10분이라고 offline 아님)
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(20) },
  });
  try {
    const r = (await runScheduledCareStatus(ENV, { now: NOW, logger: silent })).results[0];
    assert.equal(r.deviceHealth, 'online', '20분 < 25분 threshold → online 유지');
    assert.equal(r.deviceTransition, null);
  } finally {
    m.restore();
  }
});

// ═════════════════════════════════════════════════════════════════════
//  E. 실패 처리 — 성공으로 삼키지 않음
// ═════════════════════════════════════════════════════════════════════

check('17. Firestore READ 실패 (events runQuery 500) → runScheduledCareStatus rejects', async () => {
  const m = mockFirestore({ queryStatus: 500, device: { lastHeartbeatAt: iso(5) } });
  try {
    await assert.rejects(
      () => runScheduledCareStatus(ENV, { now: NOW, logger: silent }),
      (e) => e.name === 'FirestoreError' && e.status === 500,
    );
    assert.equal(m.patchCalls().length, 0, 'READ 실패면 write 안 함');
  } finally {
    m.restore();
  }
});

check('18. snapshot WRITE 실패 (careStatus PATCH 500) → rejects, 성공 처리 안 함', async () => {
  const m = mockFirestore({
    careStatusState: { fields: careStatusFields({ status: 'NORMAL', deviceHealth: 'online' }) },
    events: [{ eventType: 'motion_detected', occurredAt: iso(240) }],
    device: { lastHeartbeatAt: iso(5) },
    writeStatus: 500,
  });
  try {
    await assert.rejects(
      () => runScheduledCareStatus(ENV, { now: NOW, logger: silent }),
      (e) => e.name === 'FirestoreError' && e.status === 500,
    );
  } finally {
    m.restore();
  }
});

check('19. previous careStatus READ 실패 (403) → rejects (write 전)', async () => {
  const m = mockFirestore({
    careStatusState: { httpError: 403 },
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  try {
    await assert.rejects(
      () => runScheduledCareStatus(ENV, { now: NOW, logger: silent }),
      (e) => e.name === 'FirestoreError' && e.status === 403,
    );
    assert.equal(m.patchCalls().length, 0);
  } finally {
    m.restore();
  }
});

// ═════════════════════════════════════════════════════════════════════
//  F. scheduled() 핸들러 — controller.scheduledTime 사용 + 실패 재throw
// ═════════════════════════════════════════════════════════════════════

check('20. scheduled() → pipeline 실행 + controller.scheduledTime 을 now 로 사용', async () => {
  const m = mockFirestore({
    careStatusState: null,
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(5) },
  });
  const savedLog = console.log;
  console.log = () => {}; // scheduled() 는 기본 console 사용 — 진단 로그 억제
  try {
    await workerHandler.scheduled(
      { scheduledTime: NOW.getTime(), cron: '*/10 * * * *' },
      ENV,
    );
    console.log = savedLog;
    assert.equal(m.patchCalls().length, 1, 'scheduled() 가 careStatus write 를 트리거');
    assert.equal(m.currentDoc().status, 'NORMAL');
    assert.equal(m.currentDoc().computedAt, NOW.toISOString(), 'computedAt = scheduledTime');
  } finally {
    console.log = savedLog;
    m.restore();
  }
});

check('21. scheduled() — 파이프라인 실패 시 re-throw (Cloudflare 가 실패로 기록)', async () => {
  const m = mockFirestore({ queryStatus: 500 });
  const savedErr = console.error;
  console.error = () => {}; // 예상된 오류 로그 억제
  try {
    await assert.rejects(
      () => workerHandler.scheduled({ scheduledTime: NOW.getTime() }, ENV),
      (e) => e.name === 'FirestoreError' && e.status === 500,
    );
  } finally {
    console.error = savedErr;
    m.restore();
  }
});

// ═════════════════════════════════════════════════════════════════════
//  G. B-2 회귀
// ═════════════════════════════════════════════════════════════════════

check('22. B-2 회귀 — computeAndWriteCareStatusSnapshot 그대로 동작', async () => {
  const m = mockFirestore({
    events: [{ eventType: 'motion_detected', occurredAt: iso(5) }],
    device: { lastHeartbeatAt: iso(8) },
  });
  try {
    const res = await computeAndWriteCareStatusSnapshot(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: DEFAULT_SERVER_THRESHOLDS,
      now: NOW,
    });
    assert.equal(res.snapshot.person.status, 'NORMAL');
    assert.equal(res.transition, undefined);
    assert.equal(m.patchCalls().length, 1);
  } finally {
    m.restore();
  }
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.3 STEP B-4 — Cron scheduled() careStatus pipeline smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
