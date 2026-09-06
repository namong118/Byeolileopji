/**
 * Phase 4.3 STEP A — 서버 상태 판정 코어 스모크 + Client↔Server parity.
 *
 * 실행:  node scripts/phase43-server-carestatus-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - computeCareStatusSnapshot()  (src/services/careStatusSnapshot.ts)
 *       · 사람 축 / 기기 축 판정이 결정적이고 now 주입 가능
 *       · threshold 는 입력으로만 받는다 (env / careStatusConfig 참조 없음)
 *   - parity: careStore.project() 가 부르는 것과 **같은 인자**로
 *     deriveCareStatus / deriveDeviceHealth 를 호출한 결과와 snapshot 결과가 동일
 *   - presentHome 표시 규칙(EMERGENCY 최우선 / device offline → green NORMAL 금지)이
 *     두 경로에서 동일하게 흐른다
 */

import assert from 'node:assert/strict';

import { computeCareStatusSnapshot } from '../src/services/careStatusSnapshot.ts';
import { deriveCareStatus } from '../src/services/careStatus.ts';
import { deriveDeviceHealth } from '../src/services/deviceHealth.ts';
import { presentHome } from '../src/utils/careStatusText.ts';

const NOW = new Date('2026-09-07T12:00:00.000Z');
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
const isoIn = (minutesAhead) => new Date(NOW.getTime() + minutesAhead * 60_000).toISOString();

/** 앱 코드 기본값 (개발 override 2분이 아니다). */
const CFG = {
  inactivityCheckMinutes: 180,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
  deviceOfflineMinutes: 25,
  recomputeIntervalMs: 30_000,
  overrideTtlMs: 600_000,
};

const thresholdsOf = (cfg) => ({
  inactivityMinutes: cfg.inactivityCheckMinutes,
  deviceOfflineMinutes: cfg.deviceOfflineMinutes,
  emergencyLookbackHours: cfg.emergencyLookbackHours,
  emergencyTtlHours: cfg.emergencyTtlHours,
});

/**
 * ── 앱 경로 (mirror of careStore.project()) ────────────────────────────
 * src/stores/careStore.ts project() 가 두 축을 계산하는 방식 그대로.
 * (오버라이드 / presentHome / deriveEventViews 는 클라이언트 UI 전용이라 제외.
 *  deriveEventViews 결과 = lastActivityAt / lastSosAt / totalEventCount 는 fixture 로 주입.)
 * ⚠️ project() 의 두 derive 호출이 바뀌면 이 mirror 도 같이 바꿔야 한다.
 */
function appPath(fx, cfg, now) {
  const person = deriveCareStatus({
    lastActivityAt: fx.lastActivityAt,
    lastSosAt: fx.lastSosAt,
    totalEventCount: fx.totalEventCount,
    config: cfg,
    now,
    emergencyAckedAt: fx.emergencyAckedAt,
  });
  const device = deriveDeviceHealth({
    deviceDocExists: fx.deviceDocExists,
    lastEventAt: fx.deviceLastEventAt,
    lastHeartbeatAt: fx.lastHeartbeatAt,
    config: cfg,
    now,
  });
  return { person, device };
}

/** ── 서버 경로 (shared core) ─────────────────────────────────────────── */
function serverPath(fx, cfg, now) {
  return computeCareStatusSnapshot(
    {
      lastActivityAt: fx.lastActivityAt,
      lastSosAt: fx.lastSosAt,
      hasAnyEvents: fx.totalEventCount > 0,
      emergencyAckedAt: fx.emergencyAckedAt,
      deviceDocExists: fx.deviceDocExists,
      deviceLastEventAt: fx.deviceLastEventAt,
      lastHeartbeatAt: fx.lastHeartbeatAt,
      thresholds: thresholdsOf(cfg),
    },
    now,
  );
}

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ─────────────────────────────────────────────────────────────────────
//  A. 결정적 시나리오 (STEP A-6)
// ─────────────────────────────────────────────────────────────────────

check('1. 최근 활동 + heartbeat fresh → person NORMAL / device online', () => {
  const s = serverPath(
    { lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'NORMAL');
  assert.equal(s.person.reason, 'recent_activity');
  assert.equal(s.device.health, 'online');
  assert.equal(s.device.reason, 'heartbeat_fresh');
  assert.equal(s.computedAt, NOW.toISOString());
});

check('2. inactivity 초과 + heartbeat fresh → CHECK / online', () => {
  const s = serverPath(
    { lastActivityAt: iso(200), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'CHECK');
  assert.equal(s.person.reason, 'inactivity');
  assert.equal(s.device.health, 'online');
});

check('3. inactivity 초과 + heartbeat stale → 사람 CHECK 유지, 기기 OFFLINE 독립', () => {
  const s = serverPath(
    { lastActivityAt: iso(200), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(40) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'CHECK');
  assert.equal(s.device.health, 'offline');
  assert.equal(s.device.reason, 'heartbeat_stale');
});

check('4. person NORMAL + device OFFLINE → 사람 축 변조 없음 + Home 은 green NORMAL 금지', () => {
  const s = serverPath(
    { lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(40) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'NORMAL'); // CHECK 로 바꾸지 않는다
  assert.equal(s.person.reason, 'recent_activity');
  assert.equal(s.device.health, 'offline');
  const home = presentHome(s.person, s.device.health, NOW);
  assert.notEqual(home.tone, 'normal');
  assert.notEqual(home.headline, '오늘도 별일 없어요');
});

check('5. emergency + device ONLINE → EMERGENCY 최우선', () => {
  const s = serverPath(
    { lastSosAt: iso(120), lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'EMERGENCY');
  assert.equal(s.person.reason, 'sos');
  assert.equal(presentHome(s.person, s.device.health, NOW).tone, 'emergency');
});

check('6. emergency + device OFFLINE → EMERGENCY 최우선 (기기 무관)', () => {
  const s = serverPath(
    { lastSosAt: iso(120), lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(600) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'EMERGENCY');
  assert.equal(s.device.health, 'offline');
  assert.equal(presentHome(s.person, s.device.health, NOW).tone, 'emergency');
});

check('7. lastActivityAt 없음 → no_data (events 0건이면 systemHealth unknown)', () => {
  const noEvents = serverPath({ totalEventCount: 0, deviceDocExists: true, lastHeartbeatAt: iso(10) }, CFG, NOW);
  assert.equal(noEvents.person.reason, 'no_data');
  assert.equal(noEvents.person.systemHealth, 'unknown');

  const eventsButNoActivity = serverPath(
    { totalEventCount: 2, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(eventsButNoActivity.person.reason, 'no_data');
  assert.equal(eventsButNoActivity.person.systemHealth, 'ok');
});

check('8. lastHeartbeatAt 없음 → device unknown (문서 없으면 no_device_doc)', () => {
  const noHb = serverPath({ lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: true }, CFG, NOW);
  assert.equal(noHb.device.health, 'unknown');
  assert.equal(noHb.device.reason, 'no_heartbeat_capability');

  const noDoc = serverPath({ lastActivityAt: iso(5), totalEventCount: 3, deviceDocExists: false }, CFG, NOW);
  assert.equal(noDoc.device.health, 'unknown');
  assert.equal(noDoc.device.reason, 'no_device_doc');
});

check('9. inactivity threshold 바로 직전 (179 < 180) → NORMAL', () => {
  const s = serverPath(
    { lastActivityAt: iso(179), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'NORMAL');
});

check('10. inactivity threshold 정확히 도달 (180 → CHECK, >= 규칙)', () => {
  const s = serverPath(
    { lastActivityAt: iso(180), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(s.person.status, 'CHECK');
});

check('11. threshold 직후 → CHECK / OFFLINE 전환 (device 25 online, 26 offline)', () => {
  const check181 = serverPath(
    { lastActivityAt: iso(181), totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(10) },
    CFG,
    NOW,
  );
  assert.equal(check181.person.status, 'CHECK');

  const hb25 = serverPath({ totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(25) }, CFG, NOW);
  const hb26 = serverPath({ totalEventCount: 3, deviceDocExists: true, lastHeartbeatAt: iso(26) }, CFG, NOW);
  assert.equal(hb25.device.health, 'online');
  assert.equal(hb26.device.health, 'offline');
});

check('12. 미래 timestamp 비정상 입력 → 기존 derive 동작 그대로 (새 안전정책 없음)', () => {
  const fx = {
    lastActivityAt: isoIn(60), // 미래 활동
    lastSosAt: isoIn(30), // 미래 sos
    totalEventCount: 3,
    deviceDocExists: true,
    lastHeartbeatAt: isoIn(5), // 미래 heartbeat
  };
  const s = serverPath(fx, CFG, NOW);
  // 기존 deriveCareStatus / deriveDeviceHealth 를 직접 부른 것과 동일해야 한다
  const direct = appPath(fx, CFG, NOW);
  assert.deepEqual(s.person, direct.person);
  assert.deepEqual(s.device, direct.device);
  // 참고: 미래 sos 는 ageHours < 0 이라 EMERGENCY 아님, 미래 heartbeat 는 online
  assert.notEqual(s.person.status, 'EMERGENCY');
  assert.equal(s.device.health, 'online');
});

// ─────────────────────────────────────────────────────────────────────
//  B. Client ↔ Server parity (STEP A-7)
//     같은 fixture → appPath(project mirror) vs serverPath(shared core) 동일
// ─────────────────────────────────────────────────────────────────────

const PARITY_FIXTURES = [
  {
    name: 'NORMAL (recent + online)',
    fx: { lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(10) },
  },
  {
    name: 'CHECK (inactivity + online)',
    fx: { lastActivityAt: iso(192), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(10) },
  },
  {
    name: 'EMERGENCY (sos + offline)',
    fx: { lastSosAt: iso(90), lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(90) },
  },
  {
    name: 'EMERGENCY acknowledged → 해제',
    fx: { lastSosAt: iso(90), emergencyAckedAt: iso(30), lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(10) },
  },
  {
    name: 'DEVICE OFFLINE (NORMAL person)',
    fx: { lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(40) },
  },
  {
    name: 'UNKNOWN device (heartbeat 없음)',
    fx: { lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true },
  },
  {
    name: 'UNKNOWN person (no_data) + UNKNOWN device (no doc)',
    fx: { totalEventCount: 0, deviceDocExists: false },
  },
  {
    name: 'threshold boundary: inactivity 정확히 180 + heartbeat 정확히 25',
    fx: { lastActivityAt: iso(180), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(25) },
  },
  {
    name: 'threshold boundary: inactivity 179 + heartbeat 26',
    fx: { lastActivityAt: iso(179), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(26) },
  },
  {
    name: 'sos TTL 초과 (20h) → EMERGENCY 아님',
    fx: { lastSosAt: iso(20 * 60), lastActivityAt: iso(8), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(10) },
  },
];

for (const { name, fx } of PARITY_FIXTURES) {
  check(`parity — ${name}`, () => {
    const app = appPath(fx, CFG, NOW);
    const server = serverPath(fx, CFG, NOW);
    assert.deepEqual(server.person, app.person, 'person 축 불일치');
    assert.deepEqual(server.device, app.device, 'device 축 불일치');
    // 표시 규칙도 두 경로에서 동일하게 흐른다
    assert.deepEqual(
      presentHome(server.person, server.device.health, NOW),
      presentHome(app.person, app.device.health, NOW),
      'presentHome 불일치',
    );
  });
}

check('parity — threshold 주입값이 다르면 결과도 같이 달라진다 (env 참조 아님)', () => {
  const fx = { lastActivityAt: iso(5), totalEventCount: 5, deviceDocExists: true, lastHeartbeatAt: iso(3) };
  const strict = { ...CFG, inactivityCheckMinutes: 2, deviceOfflineMinutes: 2 };
  const app = appPath(fx, strict, NOW);
  const server = serverPath(fx, strict, NOW);
  assert.equal(server.person.status, 'CHECK'); // 5분 > 2분 → CHECK
  assert.equal(server.device.health, 'offline'); // heartbeat 3분 전 > 2분 → offline
  assert.deepEqual(server.person, app.person);
  assert.deepEqual(server.device, app.device);

  // 같은 fixture, 기본 threshold(180/25) 면 NORMAL / online
  const relaxed = serverPath(fx, CFG, NOW);
  assert.equal(relaxed.person.status, 'NORMAL');
  assert.equal(relaxed.device.health, 'online');
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.3 STEP A — server care-status core + parity smoke');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
