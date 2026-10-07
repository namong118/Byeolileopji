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
import { createEventWindowSubscription, rollTodayWindow } from '../src/services/eventWindow.ts';
import { presentHome, presentStaleHome } from '../src/utils/careStatusText.ts';
import fs from 'node:fs';

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

// ═══════════════════════════════════════════════════════════════════════
//  앱 — 구독 조정 (createEventWindowSubscription): 오류 / 날짜 전환
// ═══════════════════════════════════════════════════════════════════════

/** onSnapshot 대역. push(events) / fail(err) 로 스냅샷·오류를 흘려보낸다. */
function fakeSource() {
  const h = { opened: 0, unsubscribed: 0, onNext: null, onError: null };
  h.source = (onNext, onError) => {
    h.opened += 1;
    h.onNext = onNext;
    h.onError = onError;
    return () => {
      h.unsubscribed += 1;
    };
  };
  h.push = (events) => h.onNext(newestFirst(events));
  h.fail = (err = new Error('permission-denied')) => h.onError(err);
  return h;
}

function harness({ now, cap } = {}) {
  const recent = fakeSource();
  const sos = fakeSource();
  const todays = []; // 날짜별 today 구독 { dayStart, h }
  const emitted = [];
  const errors = [];
  let clock = now ?? APP_NOW;
  const sub = createEventWindowSubscription({
    recent: recent.source,
    latestSos: sos.source,
    today: (dayStart) => {
      const h = fakeSource();
      todays.push({ dayStart, h });
      return h.source;
    },
    listener: (events, meta) => emitted.push({ events, meta }),
    onError: (error, source) => errors.push({ error, source }),
    now: () => clock,
    cap,
  });
  return {
    sub,
    recent,
    sos,
    todays,
    today: () => todays[todays.length - 1].h,
    emitted,
    errors,
    setNow: (d) => {
      clock = d;
    },
  };
}

check('W1. 세 구독이 모두 첫 결과를 받기 전에는 listener 를 부르지 않는다', () => {
  const t = harness();
  t.recent.push(todayMotions(3));
  t.today().push(todayMotions(3));
  assert.equal(t.emitted.length, 0, 'sos 결과 전에는 내보내지 않는다 (NORMAL→EMERGENCY 깜박임 방지)');
  t.sos.push([]);
  assert.equal(t.emitted.length, 1);
  assert.equal(t.emitted[0].meta.todayTruncated, false);
});

check('W2. 첫 스냅샷 이후 sos 구독 오류 → onError 1회, 이후 다른 구독 갱신이 와도 listener 호출 안 함', () => {
  const t = harness();
  t.recent.push(todayMotions(3));
  t.today().push(todayMotions(3));
  t.sos.push([]);
  assert.equal(t.emitted.length, 1);

  t.sos.fail();
  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0].source, 'latestSos');

  // 멈춘 SOS 조각과 새 조각을 섞어 "별일 없어요" 를 계속 갱신하면 안 된다
  t.recent.push(todayMotions(10));
  t.today().push(todayMotions(10));
  assert.equal(t.emitted.length, 1, '실패 후에는 listener 가 호출되지 않는다');
});

check('W3. 여러 구독이 연달아 실패해도 onError 는 한 번만', () => {
  const t = harness();
  t.recent.push([]);
  t.today().push([]);
  t.sos.push([]);
  t.today().fail();
  t.recent.fail();
  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0].source, 'today');
});

check('W4. 첫 스냅샷 전 오류도 onError 로 드러난다 (조용히 대기 상태로 남지 않음)', () => {
  const t = harness();
  t.recent.push([]);
  t.today().fail();
  assert.equal(t.errors.length, 1);
  assert.equal(t.emitted.length, 0);
});

check('W5. unsubscribe → 세 구독 모두 해제, 이후 콜백(스냅샷/오류) 무시', () => {
  const t = harness();
  t.sub.unsubscribe();
  assert.equal(t.recent.unsubscribed, 1);
  assert.equal(t.sos.unsubscribed, 1);
  assert.equal(t.today().unsubscribed, 1);
  t.recent.push([]);
  t.today().push([]);
  t.sos.push([]);
  t.sos.fail();
  assert.equal(t.emitted.length, 0);
  assert.equal(t.errors.length, 0);
});

check('W6. checkDayRollover — 같은 날이면 false, today 구독을 다시 열지 않는다', () => {
  const t = harness();
  assert.equal(t.sub.checkDayRollover(), false);
  assert.equal(t.todays.length, 1);
  assert.equal(t.todays[0].dayStart.getTime(), startOfLocalDay(APP_NOW).getTime());
});

check('W7. 날짜 변경(백그라운드 복귀) → 즉시 어제 이벤트·어제 잘림 표시를 걷어내고 새 자정으로 재구독', () => {
  // 어제 22시: 오늘(=어제) 이벤트 2100건 → 잘림
  const t = harness({ now: APP_NOW });
  const yesterdayMany = todayMotions(2100, { startH: 6, prefix: 'y' });
  t.recent.push(yesterdayMany);
  t.today().push(yesterdayMany);
  t.sos.push([]);
  assert.equal(t.emitted.at(-1).meta.todayTruncated, true);

  // 다음 날 08:00 복귀 (60초 타이머가 아직 안 돌았다고 가정 — AppState active 경로)
  const nextMorning = new Date(startOfLocalDay(APP_NOW).getTime() + 32 * HOUR);
  t.setNow(nextMorning);
  assert.equal(t.sub.checkDayRollover(), true);

  assert.equal(t.todays[0].h.unsubscribed, 1, '이전 today 구독 해제');
  assert.equal(t.todays.length, 2, '새 today 구독');
  assert.equal(t.todays[1].dayStart.getTime(), startOfLocalDay(nextMorning).getTime());

  const last = t.emitted.at(-1);
  assert.equal(last.meta.todayTruncated, false, '어제의 잘림 표시가 오늘로 이어지지 않는다');
  const views = deriveEventViews(last.events, nextMorning);
  assert.equal(views.todayEvents.length, 0, '어제 이벤트가 오늘로 보이지 않는다');
  assert.ok(views.lastActivity, '마지막 활동(recent)은 유지');

  assert.equal(t.sub.checkDayRollover(), false, '같은 날 두 번째 확인은 no-op');
});

check('W8. rollTodayWindow — 이전 창이 전부 새 날짜면 잘림 유지, 경계가 어제 쪽이면 잘림 해제', () => {
  const dayStart = startOfLocalDay(APP_NOW).getTime();
  const allToday = newestFirst(todayMotions(6, { startH: 9 }));
  assert.equal(capTodayEvents(rollTodayWindow(allToday, dayStart), 5).truncated, true);

  const mixed = newestFirst([
    ...todayMotions(3, { startH: 9 }),
    appEvent('yy', 'motion_detected', new Date(dayStart - 1000)),
    appEvent('yz', 'motion_detected', new Date(dayStart - 2000)),
    appEvent('ya', 'motion_detected', new Date(dayStart - 3000)),
  ]);
  const rolled = rollTodayWindow(mixed, dayStart);
  assert.equal(rolled.length, 3);
  assert.equal(capTodayEvents(rolled, 5).truncated, false);
});

// ── 화면 표시: 실시간 갱신이 끊겼을 때 (presentStaleHome) ────────────────

const personResult = (over) => ({
  systemHealth: 'ok',
  computedAt: APP_NOW.toISOString(),
  lastActivityAt: new Date(APP_NOW.getTime() - 5 * MIN).toISOString(),
  minutesSinceActivity: 5,
  ...over,
});
const LAST_SYNC = localAt(APP_NOW, 21, 40).toISOString();

check('P1. 끊김 + NORMAL → "별일 없어요" 대신 중립 "최신 정보를 불러오지 못했어요" + 마지막 확인 시각', () => {
  const person = personResult({ status: 'NORMAL', reason: 'recent_activity' });
  const base = presentHome(person, 'online', APP_NOW);
  assert.equal(base.headline, '오늘도 별일 없어요', '전제');
  const t = presentStaleHome(base, person, LAST_SYNC);
  assert.equal(t.tone, 'neutral');
  assert.equal(t.headline, '최신 정보를 불러오지 못했어요');
  assert.ok(!t.headline.includes('별일 없어요') && !t.detail.includes('별일 없어요'));
  assert.match(t.detail, /오후 9:40까지 확인한 정보예요/);
});

check('P2. 끊김 + CHECK / 기기 offline → 역시 중립 문구 (확정 표현 금지)', () => {
  const chk = personResult({ status: 'CHECK', reason: 'inactivity', minutesSinceActivity: 200 });
  assert.equal(presentStaleHome(presentHome(chk, 'online', APP_NOW), chk, LAST_SYNC).tone, 'neutral');
  const normal = personResult({ status: 'NORMAL', reason: 'recent_activity' });
  const off = presentStaleHome(presentHome(normal, 'offline', APP_NOW), normal, undefined);
  assert.equal(off.tone, 'neutral');
  assert.equal(off.headline, '최신 정보를 불러오지 못했어요');
});

check('P3. 끊김 + EMERGENCY → EMERGENCY 는 숨기지 않고 "최신 정보 아님" 만 덧붙인다', () => {
  const emg = personResult({
    status: 'EMERGENCY',
    reason: 'sos',
    emergencyEventAt: localAt(APP_NOW, 21, 0).toISOString(),
  });
  const base = presentHome(emg, 'online', APP_NOW);
  const t = presentStaleHome(base, emg, LAST_SYNC);
  assert.equal(t.tone, 'emergency');
  assert.equal(t.headline, base.headline);
  assert.ok(t.detail.startsWith(base.detail));
  assert.match(t.detail, /최신 정보를 불러오지 못하고 있어요/);
});

// ── 정적 검사: careStore 연결 (RN 런타임 없이 확인 가능한 범위) ──────────
const careStoreSrc = fs.readFileSync(new URL('../src/stores/careStore.ts', import.meta.url), 'utf8');

check('static. careStore — 구독 onError 가 realtimeError 를 세우고 Hero 가 stale 로 계산된다', () => {
  const start = careStoreSrc.indexOf('function startEventsRealtime');
  assert.ok(start > 0, 'startEventsRealtime 존재');
  const body = careStoreSrc.slice(start, careStoreSrc.indexOf('\n}\n', start));
  assert.match(
    body,
    /subscribeToEvents\(\s*\(events, meta\) =>[\s\S]*?\},\s*\(\) => \{[\s\S]*realtimeError: REALTIME_ERROR_MESSAGE/,
  );
  assert.match(careStoreSrc, /stale: Boolean\(state\.realtimeError\)/);
  assert.match(careStoreSrc, /input\.stale\s*\?\s*presentStaleHome\(/);
});

check('static. careStore — AppState active: refreshDayWindow() → (끊김이면 재구독) → refreshDerived()', () => {
  const i = careStoreSrc.indexOf("AppState.addEventListener('change'");
  assert.ok(i > 0);
  const handler = careStoreSrc.slice(i, careStoreSrc.indexOf('});', i));
  const a = handler.indexOf('refreshDayWindow()');
  const b = handler.indexOf('startEventsRealtime(set, get)');
  const c = handler.indexOf('refreshDerived()');
  assert.ok(a > 0 && b > a && c > b, '순서: 날짜 창 이동 → 재구독 → 재계산');
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
