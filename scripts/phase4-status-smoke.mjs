/**
 * Phase 4.0 상태 판정 스모크 테스트 — 네트워크/Firestore 없이 순수 규칙만 검증.
 *
 * 실행:  node scripts/phase4-status-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 검증 대상:
 *   - deriveCareStatus()      : NORMAL / CHECK / EMERGENCY / no_data 판정
 *   - applyStatusOverride()   : 개발자 임시 오버라이드 + TTL 만료 복귀
 *   - presentCareStatus()     : reason 별 화면 문구 (특히 no_data ≠ "오늘도 별일 없어요")
 */

import assert from 'node:assert/strict';

import {
  deriveCareStatus,
  applyStatusOverride,
} from '../src/services/careStatus.ts';
import { presentCareStatus } from '../src/utils/careStatusText.ts';

const NOW = new Date('2026-09-04T18:00:00.000Z');
const cfg = {
  inactivityCheckMinutes: 60,
  emergencyLookbackHours: 12,
  emergencyTtlHours: 6,
  recomputeIntervalMs: 30_000,
  overrideTtlMs: 600_000,
};

const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();
const minAgo = (n) => iso(n * 60_000);
const hrAgo = (n) => iso(n * 3_600_000);

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── 1. 최근 활동 → NORMAL / recent_activity ─────────────────────────────
check('1. 최근 motion → NORMAL / recent_activity / systemHealth ok', () => {
  const r = deriveCareStatus({
    lastActivityAt: minAgo(5),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  assert.equal(r.status, 'NORMAL');
  assert.equal(r.reason, 'recent_activity');
  assert.equal(r.systemHealth, 'ok');
  assert.equal(r.minutesSinceActivity, 5);
});

// ── 2. 무활동 임계 초과 → CHECK / inactivity ────────────────────────────
check('2. threshold 초과(120분 > 60) → CHECK / inactivity', () => {
  const r = deriveCareStatus({
    lastActivityAt: minAgo(120),
    totalEventCount: 3,
    config: cfg,
    now: NOW,
  });
  assert.equal(r.status, 'CHECK');
  assert.equal(r.reason, 'inactivity');
  assert.equal(r.minutesSinceActivity, 120);
});

// ── 3. threshold 경계 ──────────────────────────────────────────────────
check('3. 경계: 정확히 60분 → CHECK, 59분 → NORMAL', () => {
  const at60 = deriveCareStatus({
    lastActivityAt: minAgo(60),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  const at59 = deriveCareStatus({
    lastActivityAt: minAgo(59),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  assert.equal(at60.status, 'CHECK');
  assert.equal(at59.status, 'NORMAL');
});

// ── 4. SOS → EMERGENCY ─────────────────────────────────────────────────
check('4. sos_triggered(30분 전) → EMERGENCY / sos', () => {
  const r = deriveCareStatus({
    lastActivityAt: minAgo(5),
    lastSosAt: minAgo(30),
    totalEventCount: 2,
    config: cfg,
    now: NOW,
  });
  assert.equal(r.status, 'EMERGENCY');
  assert.equal(r.reason, 'sos');
  assert.equal(r.emergencyEventAt, minAgo(30));
});

// ── 5. SOS 이후 motion 이 와도 여전히 EMERGENCY ────────────────────────
check('5. SOS(30분 전) + 이후 motion(1분 전) → 여전히 EMERGENCY', () => {
  const r = deriveCareStatus({
    lastActivityAt: minAgo(1),
    lastSosAt: minAgo(30),
    totalEventCount: 5,
    config: cfg,
    now: NOW,
  });
  assert.equal(r.status, 'EMERGENCY');
});

// ── 6. SOS TTL 만료 ────────────────────────────────────────────────────
check('6. SOS(7시간 전 > TTL 6) → EMERGENCY 아님', () => {
  const withRecent = deriveCareStatus({
    lastActivityAt: minAgo(3),
    lastSosAt: hrAgo(7),
    totalEventCount: 4,
    config: cfg,
    now: NOW,
  });
  assert.equal(withRecent.status, 'NORMAL');
  assert.equal(withRecent.reason, 'recent_activity');

  const withInactive = deriveCareStatus({
    lastActivityAt: minAgo(120),
    lastSosAt: hrAgo(7),
    totalEventCount: 4,
    config: cfg,
    now: NOW,
  });
  assert.equal(withInactive.status, 'CHECK');
});

check('6b. SOS + emergencyAckedAt(sos 이후) → EMERGENCY 해제', () => {
  const acked = deriveCareStatus({
    lastActivityAt: minAgo(5),
    lastSosAt: minAgo(30),
    totalEventCount: 2,
    config: cfg,
    now: NOW,
    emergencyAckedAt: NOW.getTime() - 10 * 60_000, // sos(30분전) 이후, now 이전
  });
  assert.notEqual(acked.status, 'EMERGENCY');

  const ackedBefore = deriveCareStatus({
    lastActivityAt: minAgo(5),
    lastSosAt: minAgo(30),
    totalEventCount: 2,
    config: cfg,
    now: NOW,
    emergencyAckedAt: NOW.getTime() - 60 * 60_000, // sos 이전 → 무효
  });
  assert.equal(ackedBefore.status, 'EMERGENCY');
});

// ── 7. events 0 → NORMAL / no_data / unknown ───────────────────────────
check('7. events 0건 → status NORMAL, reason no_data, systemHealth unknown', () => {
  const r = deriveCareStatus({ totalEventCount: 0, config: cfg, now: NOW });
  assert.equal(r.status, 'NORMAL'); // 내부 호환
  assert.equal(r.reason, 'no_data');
  assert.equal(r.systemHealth, 'unknown');
  assert.equal(r.minutesSinceActivity, undefined);
});

check('7b. 이벤트는 있지만 활동 이벤트가 없음 → no_data / systemHealth ok', () => {
  const r = deriveCareStatus({
    lastActivityAt: undefined,
    totalEventCount: 2,
    config: cfg,
    now: NOW,
  });
  assert.equal(r.reason, 'no_data');
  assert.equal(r.systemHealth, 'ok');
});

// ── 8. override 우선 ───────────────────────────────────────────────────
check('8. override 활성 → 파생(CHECK) 위에 NORMAL 오버라이드', () => {
  const derived = deriveCareStatus({
    lastActivityAt: minAgo(120),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  assert.equal(derived.status, 'CHECK');
  const eff = applyStatusOverride(
    derived,
    { status: 'NORMAL', until: NOW.getTime() + 60_000 },
    NOW,
  );
  assert.equal(eff.status, 'NORMAL');
  assert.equal(eff.reason, 'manual_override');
});

// ── 9. override TTL 만료 → 파생 상태 복귀 ──────────────────────────────
check('9. override 만료(until 과거) → 파생(CHECK) 그대로', () => {
  const derived = deriveCareStatus({
    lastActivityAt: minAgo(120),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  const eff = applyStatusOverride(
    derived,
    { status: 'NORMAL', until: NOW.getTime() - 1 },
    NOW,
  );
  assert.equal(eff.status, 'CHECK');
  assert.equal(eff.reason, 'inactivity');
});

// ── 10. CHECK 상태에서 새 motion 이 오면 즉시 NORMAL ───────────────────
check('10. CHECK → 새 activity(2분 전) → NORMAL', () => {
  const before = deriveCareStatus({
    lastActivityAt: minAgo(120),
    totalEventCount: 1,
    config: cfg,
    now: NOW,
  });
  assert.equal(before.status, 'CHECK');
  const after = deriveCareStatus({
    lastActivityAt: minAgo(2),
    totalEventCount: 2,
    config: cfg,
    now: NOW,
  });
  assert.equal(after.status, 'NORMAL');
  assert.equal(after.reason, 'recent_activity');
});

// ── 11. no_data 문구가 "오늘도 별일 없어요"가 아닌지 ───────────────────
check('11. presentCareStatus(no_data) 는 확정 문구를 쓰지 않는다', () => {
  const t = presentCareStatus(
    {
      status: 'NORMAL',
      reason: 'no_data',
      systemHealth: 'unknown',
      computedAt: NOW.toISOString(),
    },
    NOW,
  );
  assert.notEqual(t.headline, '오늘도 별일 없어요');
  assert.equal(t.headline, '아직 활동 정보가 없어요');
  assert.equal(t.tone, 'neutral');
  assert.ok(!/별일 없|활동이 확인됐/.test(t.headline + t.detail));
});

// ── 추가: 문구 톤 매핑 확인 ────────────────────────────────────────────
check('12. presentCareStatus 톤: recent→normal, inactivity→check, sos→emergency', () => {
  const base = { status: 'NORMAL', systemHealth: 'ok', computedAt: NOW.toISOString() };
  assert.equal(
    presentCareStatus({ ...base, reason: 'recent_activity', lastActivityAt: minAgo(5) }, NOW).tone,
    'normal',
  );
  assert.equal(
    presentCareStatus({ ...base, status: 'CHECK', reason: 'inactivity', minutesSinceActivity: 120 }, NOW).tone,
    'check',
  );
  assert.equal(
    presentCareStatus({ ...base, status: 'EMERGENCY', reason: 'sos', emergencyEventAt: minAgo(30) }, NOW).tone,
    'emergency',
  );
});

check('13. presentCareStatus(manual_override, CHECK) → CHECK 문구 + 개발자 안내', () => {
  const t = presentCareStatus(
    { status: 'CHECK', reason: 'manual_override', systemHealth: 'ok', computedAt: NOW.toISOString() },
    NOW,
  );
  assert.equal(t.headline, '한번 확인해 주세요');
  assert.equal(t.tone, 'check');
  assert.ok(/개발자/.test(t.detail));
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 4.0 status smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
