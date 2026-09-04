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

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.1a device-health smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
