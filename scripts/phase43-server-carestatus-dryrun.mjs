/**
 * Phase 4.3 STEP A — Cloudflare Worker dry-run.
 *
 * 실행:  node scripts/phase43-server-carestatus-dryrun.mjs
 *
 * cron / scheduled() / Firestore write / deploy 없음. 순수 계산만 시연한다.
 * STEP B 에서 Worker `scheduled()` 어댑터가:
 *   1. Firestore 에서 events / devices/{id} 를 읽고
 *   2. 아래 normalized 형태로 변환한 뒤
 *   3. computeCareStatusSnapshot() 을 호출하고
 *   4. 이전 스냅샷과 비교해 상태 전환을 감지 → (STEP 4.4) FCM
 * 하게 된다. 이 스크립트는 3번까지가 순수하게 동작함을 보인다.
 */

import { computeCareStatusSnapshot } from '../src/services/careStatusSnapshot.ts';

// STEP B 의 Worker 어댑터가 Firestore 조회 결과를 넣었다고 가정한 normalized 입력.
// (여기서는 하드코딩 예시 — 실제 값은 Worker 가 채운다.)
const normalizedFromFirestore = {
  lastActivityAt: '2026-09-07T02:05:00.000Z',
  lastSosAt: undefined,
  hasAnyEvents: true,
  emergencyAckedAt: undefined,
  deviceDocExists: true,
  deviceLastEventAt: '2026-09-07T02:05:00.000Z',
  lastHeartbeatAt: '2026-09-07T02:02:00.000Z',
  // 운영 threshold 는 STEP B 에서 확정. 여기서는 앱 코드 기본값을 명시 주입.
  thresholds: {
    inactivityMinutes: 180,
    deviceOfflineMinutes: 25,
    emergencyLookbackHours: 12,
    emergencyTtlHours: 12,
  },
};

const now = new Date('2026-09-07T12:00:00.000Z'); // Worker: new Date()
const snapshot = computeCareStatusSnapshot(normalizedFromFirestore, now);

console.log('Phase 4.3 STEP A — Worker dry-run (Firestore write 없음)');
console.log(JSON.stringify(snapshot, null, 2));

// STEP B 전환 감지 예시 (아직 구현 아님, 개념만):
const previous = { person: { status: 'NORMAL' }, device: { health: 'online' } };
const personChanged = previous.person.status !== snapshot.person.status;
const deviceChanged = previous.device.health !== snapshot.device.health;
console.log(
  `\n(개념) person ${previous.person.status} → ${snapshot.person.status}` +
    ` ${personChanged ? '변화' : '유지'} / device ${previous.device.health} → ${snapshot.device.health}` +
    ` ${deviceChanged ? '변화' : '유지'}`,
);
