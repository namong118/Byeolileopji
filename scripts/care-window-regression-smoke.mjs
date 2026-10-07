/**
 * 조회 창(window) 회귀 스모크 — "최근 N건" 조회 vs "시간 기준" 판정 불일치 수정.
 *
 * 실행:  node scripts/care-window-regression-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 결함: 판정·표시는 시간 기준(SOS lookback 12h / 오늘 활동 수·첫 활동)인데 조회는 개수 기준
 *       (서버 최근 100건, 앱 최근 500건)이었다. motion cooldown 5초면 몇 분 만에 N건이 차서
 *       12h 이내 SOS 가 조회 창 밖으로 밀려나 EMERGENCY 가 에러 없이 해제됐고, 앱의 오늘 활동
 *       수 / 첫 활동 시각이 잘렸다.
 *
 * 검증 대상:
 *   서버 — computeCareStatusFromFirestore() (careStatusReader.js) + 최신 sos 1건 별도 쿼리.
 *          fetch mock 이 structuredQuery(eventType 필터 / occurredAt DESC / limit)를
 *          실제 Firestore 처럼 반영한다.
 *   앱   — src/services/eventWindow.ts (세 조회 병합 / 안전 상한 / truncated) →
 *          deriveEventViews → deriveCareStatus / buildTodayActivitySummary.
 *          세 쿼리는 FirestoreEventRepository 와 같은 의미로 순수 JS 로 흉내낸다
 *          (SDK 쿼리 형태 + Rules 는 phase53-rules-hardening-emulator-test.mjs).
 *
 * 판정 규칙 / 임계값은 바꾸지 않는다 — 입력 보완만 검증한다.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { toFirestoreFields } from '../server/cloudflare-worker/src/firestore.js';
import {
  computeCareStatusFromFirestore,
  mergeEventsById as mergeServerEvents,
} from '../server/cloudflare-worker/src/careStatusReader.js';
import { queryRecentEvents } from '../server/cloudflare-worker/src/firestoreRead.js';
import {
  capTodayEvents,
  combineEventWindows,
  mergeEventsById,
  RECENT_EVENTS_LIMIT,
  startOfLocalDay,
  TODAY_EVENTS_SAFETY_CAP,
} from '../src/services/eventWindow.ts';
import { deriveEventViews } from '../src/services/eventViews.ts';
import { deriveCareStatus } from '../src/services/careStatus.ts';
import { buildTodayActivitySummary } from '../src/utils/todayActivity.ts';

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

const CARE_ID = 'dev-care-recipient';
const DEVICE_ID = 'dev-device-livingroom';
const THRESHOLDS = {
  inactivityMinutes: 180,
  deviceOfflineMinutes: 25,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
};
const SERVER_RECENT_LIMIT = 100; // careStatusReader 기본 eventLimit

// ═══════════════════════════════════════════════════════════════════════
//  서버 — Firestore REST mock (structuredQuery 를 실제로 반영)
// ═══════════════════════════════════════════════════════════════════════

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

/** events: [{ id, eventType, occurredAt(ISO) }] */
function mockFirestore({ events, heartbeatAt, sosQueryStatus = 200 }) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const body =
      opts.body && typeof opts.body === 'string' && opts.body.startsWith('{')
        ? JSON.parse(opts.body)
        : opts.body;
    calls.push({ u, method, body });

    if (u.includes('oauth2.googleapis.com/token') && method === 'POST') {
      return new Response(JSON.stringify({ access_token: 'ya29.TEST', expires_in: 3599 }), { status: 200 });
    }

    if (u.includes(':runQuery') && method === 'POST') {
      const sq = body.structuredQuery;
      assert.equal(sq.from[0].collectionId, 'events');
      const filters = sq.where.compositeFilter ? sq.where.compositeFilter.filters : [sq.where];
      let selected = [...events];
      for (const { fieldFilter: ff } of filters) {
        assert.equal(ff.op, 'EQUAL');
        selected = selected.filter((e) =>
          ff.field.fieldPath === 'careRecipientId'
            ? CARE_ID === ff.value.stringValue
            : e[ff.field.fieldPath] === ff.value.stringValue,
        );
      }
      const isSosQuery = filters.some((f) => f.fieldFilter.field.fieldPath === 'eventType');
      if (isSosQuery && sosQueryStatus !== 200) {
        return new Response('{"error":{"status":"FAILED_PRECONDITION"}}', { status: sosQueryStatus });
      }
      assert.equal(sq.orderBy[0].field.fieldPath, 'occurredAt');
      assert.equal(sq.orderBy[0].direction, 'DESCENDING');
      selected.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
      selected = selected.slice(0, sq.limit);
      const rows = selected.map((e) => ({
        document: {
          name: `projects/p/databases/(default)/documents/events/${e.id}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            eventType: e.eventType,
            occurredAt: new Date(e.occurredAt),
          }),
        },
      }));
      rows.push({ readTime: new Date().toISOString() });
      return new Response(JSON.stringify(rows), { status: 200 });
    }

    if (u.includes('/devices/') && method === 'GET') {
      return new Response(
        JSON.stringify({
          name: `projects/p/databases/(default)/documents/devices/${DEVICE_ID}`,
          fields: toFirestoreFields({
            careRecipientId: CARE_ID,
            type: 'ESP32_PIR',
            enabled: true,
            lastHeartbeatAt: new Date(heartbeatAt),
          }),
        }),
        { status: 200 },
      );
    }
    return new Response('UNEXPECTED ' + method + ' ' + u, { status: 599 });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const SERVER_NOW = new Date('2026-09-07T12:00:00.000Z');
const ago = (ms) => new Date(SERVER_NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** SOS 1건 + 그 이후 motion n건 (5초 간격 = 펌웨어 MOTION_COOLDOWN_MS) */
function sosThenMotions({ sosAgoMs, motions }) {
  const events = [{ id: 'sos-1', eventType: 'sos_triggered', occurredAt: ago(sosAgoMs) }];
  for (let i = 0; i < motions; i += 1) {
    events.push({ id: `m-${i}`, eventType: 'motion_detected', occurredAt: ago(i * 5_000) });
  }
  return events;
}

async function serverCompute(opts) {
  const m = mockFirestore({ heartbeatAt: ago(2 * MIN), ...opts });
  try {
    const r = await computeCareStatusFromFirestore(ENV, {
      careRecipientId: CARE_ID,
      deviceId: DEVICE_ID,
      thresholds: THRESHOLDS,
      now: SERVER_NOW,
    });
    return { ...r, calls: m.calls };
  } finally {
    m.restore();
  }
}

check('S0. 전제 — SOS 이후 motion 150건이면 SOS 는 "최근 100건" 조회 창 밖이다', async () => {
  const events = sosThenMotions({ sosAgoMs: 30 * MIN, motions: 150 });
  const m = mockFirestore({ events, heartbeatAt: ago(2 * MIN) });
  try {
    const recent = await queryRecentEvents(ENV, CARE_ID, SERVER_RECENT_LIMIT);
    assert.equal(recent.length, SERVER_RECENT_LIMIT);
    assert.ok(!recent.some((e) => e.eventType === 'sos_triggered'), '재현 조건이 성립해야 한다');
  } finally {
    m.restore();
  }
});

check('S1. SOS(30분 전) 이후 motion 150건 → EMERGENCY 유지 (lookback·TTL 내)', async () => {
  const { input, snapshot } = await serverCompute({
    events: sosThenMotions({ sosAgoMs: 30 * MIN, motions: 150 }),
  });
  assert.equal(input.lastSosAt, ago(30 * MIN));
  assert.equal(snapshot.person.status, 'EMERGENCY');
});

check('S2. SOS(11시간 전) 이후 motion 5000건 → EMERGENCY 유지', async () => {
  const { snapshot } = await serverCompute({
    events: sosThenMotions({ sosAgoMs: 11 * HOUR, motions: 5000 }),
  });
  assert.equal(snapshot.person.status, 'EMERGENCY');
});

check('S3. SOS 가 lookback(12h) 을 지나면 기존대로 해제 (회귀 없음)', async () => {
  const { input, snapshot } = await serverCompute({
    events: sosThenMotions({ sosAgoMs: 13 * HOUR, motions: 150 }),
  });
  assert.equal(input.lastSosAt, ago(13 * HOUR), 'sos 는 읽히지만');
  assert.notEqual(snapshot.person.status, 'EMERGENCY', '판정은 기존 lookback 규칙대로 해제');
  assert.equal(snapshot.person.status, 'NORMAL');
});

check('S4. SOS 가 최근 100건 안에 있어도 중복 없이 1건으로 병합', async () => {
  const { input, snapshot } = await serverCompute({
    events: sosThenMotions({ sosAgoMs: 1 * MIN, motions: 5 }),
  });
  assert.equal(input.lastSosAt, ago(1 * MIN));
  assert.equal(snapshot.person.status, 'EMERGENCY');
  const merged = mergeServerEvents(
    [{ id: 'sos-1', eventType: 'sos_triggered' }, { id: 'm-0', eventType: 'motion_detected' }],
    [{ id: 'sos-1', eventType: 'sos_triggered' }],
  );
  assert.deepEqual(merged.map((e) => e.id), ['sos-1', 'm-0']);
});

check('S5. 최신 sos 쿼리 형태 — events / careRecipientId·eventType EQUAL AND / occurredAt DESC / limit 1', async () => {
  const { calls } = await serverCompute({ events: sosThenMotions({ sosAgoMs: 30 * MIN, motions: 3 }) });
  const queries = calls.filter((c) => c.u.includes(':runQuery'));
  assert.equal(queries.length, 2, 'events 쿼리 2회 (최근 N건 + 최신 sos)');
  const sos = queries.find((c) => c.body.structuredQuery.where.compositeFilter);
  assert.ok(sos, 'compositeFilter 쿼리가 있어야 한다');
  const sq = sos.body.structuredQuery;
  assert.equal(sq.where.compositeFilter.op, 'AND');
  const ff = sq.where.compositeFilter.filters.map((f) => f.fieldFilter);
  assert.deepEqual(
    ff.map((f) => [f.field.fieldPath, f.op, f.value.stringValue]),
    [
      ['careRecipientId', 'EQUAL', CARE_ID],
      ['eventType', 'EQUAL', 'sos_triggered'],
    ],
  );
  assert.deepEqual(sq.orderBy, [{ field: { fieldPath: 'occurredAt' }, direction: 'DESCENDING' }]);
  assert.equal(sq.limit, 1);
  // 최근 N건 쿼리는 기존 그대로 (limit 100, careRecipientId 단일 필터)
  const recent = queries.find((c) => !c.body.structuredQuery.where.compositeFilter);
  assert.equal(recent.body.structuredQuery.limit, SERVER_RECENT_LIMIT);
});

check('S6. 최신 sos 쿼리 실패(인덱스 미배포 400 등) → 조용히 판정하지 않고 reject', async () => {
  await assert.rejects(
    serverCompute({ events: sosThenMotions({ sosAgoMs: 30 * MIN, motions: 3 }), sosQueryStatus: 400 }),
    /Firestore 400/,
  );
});

check('S7. sos 이벤트가 전혀 없으면 lastSosAt 없음 → 기존 판정 (NORMAL)', async () => {
  const events = Array.from({ length: 120 }, (_, i) => ({
    id: `m-${i}`,
    eventType: 'motion_detected',
    occurredAt: ago(i * 5_000),
  }));
  const { input, snapshot } = await serverCompute({ events });
  assert.equal(input.lastSosAt, undefined);
  assert.equal(snapshot.person.status, 'NORMAL');
});

// ═══════════════════════════════════════════════════════════════════════
//  앱 — 세 조회 창 (FirestoreEventRepository 와 같은 의미의 순수 흉내)
// ═══════════════════════════════════════════════════════════════════════

const APP_CONFIG = {
  inactivityCheckMinutes: 180,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
  deviceOfflineMinutes: 25,
  recomputeIntervalMs: 0,
  overrideTtlMs: 0,
};

/** 러너 타임존과 무관하게 "오늘 h:m" (로컬) */
function localAt(base, h, m = 0, s = 0) {
  const d = new Date(base);
  d.setHours(h, m, s, 0);
  return d;
}
const APP_NOW = localAt(new Date('2026-09-07T12:00:00.000Z'), 22, 0);

const appEvent = (id, eventType, date) => ({
  id,
  eventType,
  source: 'sensor',
  occurredAt: date.toISOString(),
});

const newestFirst = (list) =>
  [...list].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

/** FirestoreEventRepository 의 recent / today / sos 쿼리를 그대로 흉내낸다. */
function appQueries(all, now = APP_NOW) {
  const sorted = newestFirst(all);
  const dayStart = startOfLocalDay(now).getTime();
  return {
    recent: sorted.slice(0, RECENT_EVENTS_LIMIT),
    today: sorted.filter((e) => Date.parse(e.occurredAt) >= dayStart).slice(0, TODAY_EVENTS_SAFETY_CAP + 1),
    latestSos: sorted.filter((e) => e.eventType === 'sos_triggered').slice(0, 1),
  };
}

/** 오늘 start 시각부터 stepSec 간격 motion n건 */
function todayMotions(n, { startH = 6, stepSec = 5, prefix = 't' } = {}) {
  const start = localAt(APP_NOW, startH, 0).getTime();
  return Array.from({ length: n }, (_, i) =>
    appEvent(`${prefix}-${i}`, 'motion_detected', new Date(start + i * stepSec * 1000)),
  );
}

function appSummary(all) {
  const win = combineEventWindows(appQueries(all));
  const views = deriveEventViews(win.events, APP_NOW);
  return {
    win,
    views,
    summary: buildTodayActivitySummary(views.events, APP_NOW, undefined, { truncated: win.todayTruncated }),
  };
}

check('A0. 상수 — recent 100, 안전 상한 2000', () => {
  assert.equal(RECENT_EVENTS_LIMIT, 100);
  assert.equal(TODAY_EVENTS_SAFETY_CAP, 2000);
});

check('A1. startOfLocalDay — 로컬 00:00:00.000, 같은 날', () => {
  const d = startOfLocalDay(APP_NOW);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
  assert.equal(d.getDate(), APP_NOW.getDate());
});

check('A2. 오늘 motion 800건 (기존 500건 초과) → 오늘 활동 800회, 첫 활동 시각 정확, truncated=false', () => {
  const all = todayMotions(800, { startH: 6 });
  // 재현 전제: 예전 단일 쿼리(최근 500건)라면 첫 활동이 잘렸다.
  const old = buildTodayActivitySummary(newestFirst(all).slice(0, 500), APP_NOW);
  assert.equal(old.count, 500);
  assert.notEqual(old.firstAt, '오전 6:00');

  const { win, summary, views } = appSummary(all);
  assert.equal(win.todayTruncated, false);
  assert.equal(views.todayEvents.length, 800);
  assert.equal(summary.count, 800);
  assert.equal(summary.countText, '800회');
  assert.equal(summary.truncated, false);
  assert.equal(summary.firstAt, '오전 6:00');
});

check('A3. 어제 이벤트가 많아도 오늘 집계에 섞이지 않는다', () => {
  const yesterday = Array.from({ length: 300 }, (_, i) =>
    appEvent(`y-${i}`, 'motion_detected', new Date(localAt(APP_NOW, 0, 0).getTime() - (i + 1) * 5000)),
  );
  const { summary } = appSummary([...yesterday, ...todayMotions(10, { startH: 7 })]);
  assert.equal(summary.count, 10);
  assert.equal(summary.firstAt, '오전 7:00');
});

check('A4. 오늘 이벤트 정확히 2000건(상한) → 잘림 아님, 정확한 수/첫 활동', () => {
  const { win, summary } = appSummary(todayMotions(2000, { startH: 6 }));
  assert.equal(win.todayTruncated, false);
  assert.equal(summary.count, 2000);
  assert.equal(summary.countText, '2000회');
  assert.equal(summary.firstAt, '오전 6:00');
});

check('A5. 오늘 이벤트 상한 초과(2500건) → truncated=true, "2000회 이상", 첫 활동 시각 없음', () => {
  const { win, summary } = appSummary(todayMotions(2500, { startH: 6 }));
  assert.equal(win.todayTruncated, true);
  assert.equal(summary.truncated, true);
  assert.equal(summary.count, 2000);
  assert.equal(summary.countText, '2000회 이상');
  assert.equal(summary.firstAt, undefined, '조회 창 밖의 실제 첫 활동을 거짓 시각으로 대체하지 않는다');
  assert.ok(summary.lastAt);
  assert.match(summary.text, /^2000번 이상 · 마지막 /);
});

check('A6. capTodayEvents — CAP+1 번째가 있어야 잘림, 최신 우선 CAP 건만 남김', () => {
  const list = newestFirst(todayMotions(5));
  assert.deepEqual(capTodayEvents(list, 5), { events: list, truncated: false });
  const r = capTodayEvents(list, 4);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.events.map((e) => e.id), list.slice(0, 4).map((e) => e.id));
});

check('A7. 앱 EMERGENCY — SOS(30분 전) 이후 motion 600건이어도 lastSos 유지 → EMERGENCY', () => {
  const sosAt = new Date(APP_NOW.getTime() - 30 * MIN);
  const motions = Array.from({ length: 600 }, (_, i) =>
    appEvent(`m-${i}`, 'motion_detected', new Date(APP_NOW.getTime() - i * 2_000)),
  );
  const all = [appEvent('sos-1', 'sos_triggered', sosAt), ...motions];
  assert.ok(!newestFirst(all).slice(0, 500).some((e) => e.eventType === 'sos_triggered'), '재현 전제');

  const win = combineEventWindows(appQueries(all));
  const views = deriveEventViews(win.events, APP_NOW);
  assert.equal(views.lastSos?.id, 'sos-1');
  const status = deriveCareStatus({
    lastActivityAt: views.lastActivity?.occurredAt,
    lastSosAt: views.lastSos?.occurredAt,
    totalEventCount: views.events.length,
    config: APP_CONFIG,
    now: APP_NOW,
  });
  assert.equal(status.status, 'EMERGENCY');
});

check('A8. 앱 — SOS 가 lookback 을 지나면 기존대로 해제', () => {
  const all = [
    appEvent('sos-old', 'sos_triggered', new Date(APP_NOW.getTime() - 13 * HOUR)),
    ...todayMotions(150, { startH: 21 }),
  ];
  const views = deriveEventViews(combineEventWindows(appQueries(all)).events, APP_NOW);
  assert.equal(views.lastSos?.id, 'sos-old');
  const status = deriveCareStatus({
    lastActivityAt: views.lastActivity?.occurredAt,
    lastSosAt: views.lastSos?.occurredAt,
    totalEventCount: views.events.length,
    config: APP_CONFIG,
    now: APP_NOW,
  });
  assert.equal(status.status, 'NORMAL');
});

check('A9. 0시 직후 오늘 이벤트 0건 → recent 조회로 마지막 활동 유지, 오늘 0회', () => {
  const now = localAt(APP_NOW, 0, 5);
  const lastNight = appEvent('n-1', 'motion_detected', new Date(now.getTime() - 20 * MIN));
  const win = combineEventWindows(appQueries([lastNight], now));
  const views = deriveEventViews(win.events, now);
  assert.equal(views.lastActivity?.id, 'n-1');
  assert.equal(views.todayEvents.length, 0);
  const s = buildTodayActivitySummary(views.events, now, undefined, { truncated: win.todayTruncated });
  assert.equal(s.count, 0);
  assert.equal(s.countText, '0회');
});

check('A10. mergeEventsById — 세 조회에 중복된 문서는 1건으로', () => {
  const a = appEvent('x', 'motion_detected', APP_NOW);
  const b = appEvent('y', 'sos_triggered', APP_NOW);
  assert.deepEqual(mergeEventsById([a, b], [a], [b]).map((e) => e.id), ['x', 'y']);
  const win = combineEventWindows(appQueries([a, b]));
  assert.equal(win.events.length, 2);
});

check('A11. truncated 옵션 미지정 = 기존 동작 (countText / truncated=false 만 추가)', () => {
  const s = buildTodayActivitySummary(todayMotions(3, { startH: 9, stepSec: 60 }), APP_NOW);
  assert.equal(s.count, 3);
  assert.equal(s.countText, '3회');
  assert.equal(s.truncated, false);
  assert.equal(s.text, '3번 · 오전 9:00 ~ 오전 9:02');
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Care window regression smoke (최근 N건 조회 vs 시간 기준 판정)');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
