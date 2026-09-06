/**
 * Phase 4.1a 기기 축(Device Health) 스모크 테스트 — 네트워크/Firestore 없이 순수 로직만.
 *
 * 실행:  node scripts/phase41-devicehealth-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - deriveDeviceHealth()  : online / offline / unknown 판정 (사람 축과 완전 독립)
 *   - presentHome()         : 사람 축 + 기기 축 표시 경계 조합
 *       ⚠️ device offline 이면 "오늘도 별일 없어요" 초록 Hero 금지 → neutral
 *       ⚠️ EMERGENCY 는 기기 상태와 무관하게 최우선
 *       ⚠️ device unknown 은 장애가 아님 → 기존 Hero 유지
 */

import assert from 'node:assert/strict';

import { deriveDeviceHealth } from '../src/services/deviceHealth.ts';
import { presentHome } from '../src/utils/careStatusText.ts';
import { ACTIVITY_EVENT_TYPES } from '../src/services/eventViews.ts';
import { presentSensorRow } from '../src/utils/deviceHealthText.ts';
import { formatClock, formatRelativeDetailed } from '../src/utils/time.ts';
import {
  buildTodayActivitySummary,
  DAILY_LIVING_ACTIVITY_EVENT_TYPES,
} from '../src/utils/todayActivity.ts';

const NOW = new Date('2026-09-04T18:00:00.000Z');
const cfg = { deviceOfflineMinutes: 25 };
const minAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();

/** 사람 축 결과를 손으로 만든다 (deriveCareStatus 는 phase4 스모크에서 검증됨) */
const personStatus = (over = {}) => ({
  status: 'NORMAL',
  reason: 'recent_activity',
  systemHealth: 'ok',
  lastActivityAt: minAgo(5),
  minutesSinceActivity: 5,
  computedAt: NOW.toISOString(),
  ...over,
});

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── 1. device doc 없음 → unknown / no_device_doc ───────────────────────
check('1. device doc 없음 → unknown / no_device_doc', () => {
  const r = deriveDeviceHealth({ deviceDocExists: false, config: cfg, now: NOW });
  assert.equal(r.health, 'unknown');
  assert.equal(r.reason, 'no_device_doc');
});

// ── 2. lastEventAt 만 있음 + heartbeat 없음 → unknown / no_heartbeat_capability
check('2. lastEventAt 만 있음(heartbeat 없음) → unknown / no_heartbeat_capability', () => {
  const r = deriveDeviceHealth({
    deviceDocExists: true,
    lastEventAt: minAgo(3),
    config: cfg,
    now: NOW,
  });
  assert.equal(r.health, 'unknown');
  assert.equal(r.reason, 'no_heartbeat_capability');
  assert.equal(r.lastSeenAt, minAgo(3));
  assert.equal(r.minutesSinceSeen, 3);
});

// ── 3. lastEventAt 이 매우 오래됨 + heartbeat 없음 → 여전히 unknown (offline 아님) ─
check('3. lastEventAt 이 6시간 전 + heartbeat 없음 → unknown (offline 아님)', () => {
  const r = deriveDeviceHealth({
    deviceDocExists: true,
    lastEventAt: minAgo(360),
    config: cfg,
    now: NOW,
  });
  assert.equal(r.health, 'unknown'); // ← 핵심: 오래된 lastEventAt 으로 offline 판정 안 함
  assert.equal(r.reason, 'no_heartbeat_capability');
  assert.equal(r.minutesSinceSeen, 360);
});

// ── 4. synthetic fresh heartbeat → online ─────────────────────────────
check('4. lastHeartbeatAt 10분 전 (< 25) → online / heartbeat_fresh', () => {
  const r = deriveDeviceHealth({
    deviceDocExists: true,
    lastEventAt: minAgo(200),
    lastHeartbeatAt: minAgo(10),
    config: cfg,
    now: NOW,
  });
  assert.equal(r.health, 'online');
  assert.equal(r.reason, 'heartbeat_fresh');
  assert.equal(r.lastSeenAt, minAgo(10)); // max(event, heartbeat)
});

// ── 5. synthetic stale heartbeat → offline ────────────────────────────
check('5. lastHeartbeatAt 40분 전 (> 25) → offline / heartbeat_stale', () => {
  const r = deriveDeviceHealth({
    deviceDocExists: true,
    lastHeartbeatAt: minAgo(40),
    config: cfg,
    now: NOW,
  });
  assert.equal(r.health, 'offline');
  assert.equal(r.reason, 'heartbeat_stale');
});

check('5b. 경계: heartbeat 정확히 25분 전 → online, 26분 전 → offline', () => {
  assert.equal(
    deriveDeviceHealth({ deviceDocExists: true, lastHeartbeatAt: minAgo(25), config: cfg, now: NOW }).health,
    'online',
  );
  assert.equal(
    deriveDeviceHealth({ deviceDocExists: true, lastHeartbeatAt: minAgo(26), config: cfg, now: NOW }).health,
    'offline',
  );
});

// ── 6. 사람 NORMAL + device offline → Hero 가 "오늘도 별일 없어요" 아님 ─
check('6. 사람 NORMAL(recent) + device offline → neutral Hero, "오늘도 별일 없어요" 아님', () => {
  const t = presentHome(personStatus(), 'offline', NOW);
  assert.notEqual(t.headline, '오늘도 별일 없어요');
  assert.equal(t.tone, 'neutral');
  assert.equal(t.headline, '센서 연결을 확인하고 있어요');
  assert.ok(!/별일 없|활동이 확인됐어요/.test(t.headline + t.detail));
});

check('6b. 사람 CHECK(inactivity) + device offline → neutral Hero', () => {
  const t = presentHome(
    personStatus({ status: 'CHECK', reason: 'inactivity', minutesSinceActivity: 200, lastActivityAt: minAgo(200) }),
    'offline',
    NOW,
  );
  assert.equal(t.tone, 'neutral');
  assert.notEqual(t.headline, '한번 확인해 주세요');
});

// ── 7. 사람 NORMAL + device unknown + 최근 activity → 기존 NORMAL Hero 허용 ─
check('7. 사람 NORMAL(recent) + device unknown → 기존 NORMAL Hero ("오늘도 별일 없어요")', () => {
  const t = presentHome(personStatus(), 'unknown', NOW);
  assert.equal(t.headline, '오늘도 별일 없어요');
  assert.equal(t.tone, 'normal');
});

// ── 8. 사람 EMERGENCY + device offline → EMERGENCY 우선 ───────────────
check('8. 사람 EMERGENCY + device offline → EMERGENCY Hero (기기 무관)', () => {
  const t = presentHome(
    personStatus({ status: 'EMERGENCY', reason: 'sos', emergencyEventAt: minAgo(20) }),
    'offline',
    NOW,
  );
  assert.equal(t.tone, 'emergency');
  assert.equal(t.headline, '도움이 필요할 수 있어요');
});

// ── 9. 사람 no_data + device unknown → 기존 no_data 중립 문구 ──────────
check('9. 사람 no_data + device unknown → "아직 활동 정보가 없어요"', () => {
  const t = presentHome(
    { status: 'NORMAL', reason: 'no_data', systemHealth: 'unknown', computedAt: NOW.toISOString() },
    'unknown',
    NOW,
  );
  assert.equal(t.headline, '아직 활동 정보가 없어요');
  assert.notEqual(t.headline, '오늘도 별일 없어요');
});

check('9b. 사람 no_data + device online → 여전히 "아직 활동 정보가 없어요"', () => {
  const t = presentHome(
    { status: 'NORMAL', reason: 'no_data', systemHealth: 'unknown', computedAt: NOW.toISOString() },
    'online',
    NOW,
  );
  assert.equal(t.headline, '아직 활동 정보가 없어요');
});

// ── 10. (Phase 4.1b) 사람 CHECK + device online → 사람 활동 확인 UI ────
//    CHECK 와 offline 을 혼동하지 않는다: 센서는 살아있고 사람이 조용한 것.
check('10. 사람 CHECK(inactivity) + device online → "한번 확인해 주세요" (CHECK UI 유지)', () => {
  const t = presentHome(
    personStatus({ status: 'CHECK', reason: 'inactivity', minutesSinceActivity: 200, lastActivityAt: minAgo(200) }),
    'online',
    NOW,
  );
  assert.equal(t.tone, 'check');
  assert.equal(t.headline, '한번 확인해 주세요');
  assert.notEqual(t.headline, '센서 연결을 확인하고 있어요');
});

check('10b. deriveDeviceHealth: lastEventAt 신선 + heartbeat 없음 → 여전히 unknown', () => {
  // heartbeat 도입 후에도, 특정 기기가 아직 heartbeat 를 안 보냈으면 unknown 이어야 한다
  const r = deriveDeviceHealth({
    deviceDocExists: true,
    lastEventAt: minAgo(1),
    config: cfg,
    now: NOW,
  });
  assert.equal(r.health, 'unknown');
  assert.equal(r.reason, 'no_heartbeat_capability');
});

// ── 11. (STEP B) presentSensorRow — 홈 "센서 연결" 행 문구 ──────────────
check('11. presentSensorRow: online + 사람 NORMAL → "정상"', () => {
  assert.deepEqual(presentSensorRow('online', 'NORMAL'), {
    label: '센서 연결',
    value: '정상',
  });
});

check('11b. presentSensorRow: online + 사람 CHECK → "정상 · 신호는 계속 오고 있어요" (센서 고장 아님)', () => {
  assert.equal(
    presentSensorRow('online', 'CHECK').value,
    '정상 · 신호는 계속 오고 있어요',
  );
});

check('11c. presentSensorRow: offline → "신호가 끊겼어요"', () => {
  assert.equal(presentSensorRow('offline', 'NORMAL').value, '신호가 끊겼어요');
  assert.equal(presentSensorRow('offline', 'CHECK').value, '신호가 끊겼어요');
});

check('11d. presentSensorRow: unknown → null (행 자체를 숨김, 장애로 표현 안 함)', () => {
  assert.equal(presentSensorRow('unknown', 'NORMAL'), null);
  assert.equal(presentSensorRow('unknown', 'CHECK'), null);
});

check('11e. 홈 "센서 연결" 문구에 개발자 enum(online/offline/heartbeat/reason)이 새지 않는다', () => {
  for (const [h, p] of [
    ['online', 'NORMAL'],
    ['online', 'CHECK'],
    ['offline', 'NORMAL'],
  ]) {
    const row = presentSensorRow(h, p);
    assert.ok(!/online|offline|unknown|heartbeat|reason/i.test(row.value));
  }
});

// ── 12. (STEP B) formatRelativeDetailed — 마지막 활동 상대시간 ──────────
check('12. formatRelativeDetailed: 방금 / 12분 전 / 3시간 12분 전 / 5시간 전 / 1일 전', () => {
  const base = new Date('2026-09-04T18:00:00.000Z');
  const ago = (m) => new Date(base.getTime() - m * 60_000).toISOString();
  assert.equal(formatRelativeDetailed(ago(0), base), '방금');
  assert.equal(formatRelativeDetailed(ago(12), base), '12분 전');
  assert.equal(formatRelativeDetailed(ago(3 * 60 + 12), base), '3시간 12분 전');
  assert.equal(formatRelativeDetailed(ago(5 * 60), base), '5시간 전');
  assert.equal(formatRelativeDetailed(ago(26 * 60), base), '1일 전');
});

// ── 13. (STEP C/D) buildTodayActivitySummary — 오늘 활동 요약 ──────────
//    STEP D: 홈 "오늘 활동" 카운트는 DAILY_LIVING_ACTIVITY_EVENT_TYPES(모션/문/외출/귀가)
//    만 센다. eventViews.ts 의 ACTIVITY_EVENT_TYPES(복약·워치 포함)와 다르다.
//    로컬 날짜 기준으로 오늘 이벤트를 만든다 (러너 타임존과 무관하게 안정적).
function atToday(h, m = 0) {
  const d = new Date(NOW);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
function atYesterday(h, m = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const ev = (eventType, iso) => ({
  id: iso,
  eventType,
  source: 'sensor',
  occurredAt: iso,
});

check('13. 오늘 활동 0건 → count 0, "아직 확인된 활동이 없어요", 시각 없음', () => {
  const s = buildTodayActivitySummary([], NOW);
  assert.equal(s.count, 0);
  assert.equal(s.text, '아직 확인된 활동이 없어요');
  assert.equal(s.firstAt, undefined);
  assert.equal(s.lastAt, undefined);
});

check('13b. 오늘 활동 1건 → count 1, 범위 중복 없이 "1번 · 오전 9:00"', () => {
  const s = buildTodayActivitySummary([ev('motion_detected', atToday(9, 0))], NOW);
  assert.equal(s.count, 1);
  assert.equal(s.text, '1번 · 오전 9:00');
  assert.equal(s.firstAt, '오전 9:00');
  assert.equal(s.lastAt, '오전 9:00');
});

check('13c. 오늘 활동 여러 건 → "8번 · 오전 7:10 ~ 오후 3:12" (순서 무관)', () => {
  const times = [[15, 12], [7, 10], [8, 32], [10, 15], [11, 40], [13, 20], [14, 5], [14, 42]];
  const events = times.map(([h, m]) => ev('motion_detected', atToday(h, m)));
  const s = buildTodayActivitySummary(events, NOW);
  assert.equal(s.count, 8);
  assert.equal(s.firstAt, '오전 7:10');
  assert.equal(s.lastAt, '오후 3:12');
  assert.equal(s.text, '8번 · 오전 7:10 ~ 오후 3:12');
});

check('13d. 어제 이벤트는 오늘 집계에서 제외', () => {
  const s = buildTodayActivitySummary(
    [
      ev('motion_detected', atYesterday(9, 0)),
      ev('motion_detected', atYesterday(22, 0)),
      ev('motion_detected', atToday(10, 30)),
    ],
    NOW,
  );
  assert.equal(s.count, 1);
  assert.equal(s.firstAt, '오전 10:30');
});

check('13e. (STEP D) 포함 종류: motion_detected / door_opened / returned_home / left_home', () => {
  const s = buildTodayActivitySummary(
    [
      ev('motion_detected', atToday(7, 0)),
      ev('door_opened', atToday(8, 0)),
      ev('left_home', atToday(9, 0)),
      ev('returned_home', atToday(17, 0)),
    ],
    NOW,
  );
  assert.equal(s.count, 4);
  assert.equal(s.text, '4번 · 오전 7:00 ~ 오후 5:00');
});

check('13f. (STEP D) 제외 종류: medication_taken / watch_activity / sos_triggered / medication_missed', () => {
  const s = buildTodayActivitySummary(
    [
      ev('medication_taken', atToday(8, 0)),
      ev('watch_activity', atToday(9, 0)),
      ev('sos_triggered', atToday(10, 0)),
      ev('medication_missed', atToday(11, 0)),
      ev('motion_detected', atToday(12, 30)),
    ],
    NOW,
  );
  assert.equal(s.count, 1); // motion_detected 만
  assert.equal(s.text, '1번 · 오후 12:30');
});

check('13g. (STEP D) 오늘 활동 분류 ≠ eventViews.ACTIVITY_EVENT_TYPES', () => {
  // medication_taken / watch_activity 는 ACTIVITY_EVENT_TYPES 에는 있지만
  // 홈 "오늘 활동" 카운트(DAILY_LIVING_ACTIVITY_EVENT_TYPES)에는 없다.
  assert.ok(ACTIVITY_EVENT_TYPES.has('medication_taken'));
  assert.ok(ACTIVITY_EVENT_TYPES.has('watch_activity'));
  assert.ok(!DAILY_LIVING_ACTIVITY_EVENT_TYPES.has('medication_taken'));
  assert.ok(!DAILY_LIVING_ACTIVITY_EVENT_TYPES.has('watch_activity'));
  for (const t of ['motion_detected', 'door_opened', 'returned_home', 'left_home']) {
    assert.ok(DAILY_LIVING_ACTIVITY_EVENT_TYPES.has(t));
  }
});

check('13h. 첫/마지막 활동 시각 정확성 (입력이 뒤섞여 있어도)', () => {
  const s = buildTodayActivitySummary(
    [
      ev('door_opened', atToday(20, 5)),
      ev('motion_detected', atToday(6, 45)),
      ev('returned_home', atToday(12, 0)),
    ],
    NOW,
  );
  assert.equal(s.firstAt, '오전 6:45');
  assert.equal(s.lastAt, '오후 8:05');
  assert.equal(s.count, 3);
});

check('13i. 날짜 경계 — 오늘 00:00 포함 / 어제 23:59 제외', () => {
  const s = buildTodayActivitySummary(
    [
      ev('motion_detected', atYesterday(23, 59)),
      ev('motion_detected', atToday(0, 0)),
    ],
    NOW,
  );
  assert.equal(s.count, 1);
  assert.equal(s.firstAt, '오전 12:00');
});

// ── 14. (STEP D) formatClock — 보호자용 12시간 표기 통일 ───────────────
check('14. formatClock: 07:10→오전 7:10 / 12:03→오후 12:03 / 15:43→오후 3:43 / 00:05→오전 12:05', () => {
  const at = (h, m) => {
    const d = new Date(NOW);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  assert.equal(formatClock(at(7, 10)), '오전 7:10');
  assert.equal(formatClock(at(12, 3)), '오후 12:03');
  assert.equal(formatClock(at(15, 43)), '오후 3:43');
  assert.equal(formatClock(at(0, 5)), '오전 12:05');
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.1a/4.1b device-health smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
