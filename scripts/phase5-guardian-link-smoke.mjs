/**
 * Phase 5 STEP 5.2 — guardianLinks 순수 로직 smoke.
 *
 * 실행:  node scripts/phase5-guardian-link-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * Firestore 네트워크 호출 없이 src/services/guardianLink.ts (순수) 만 검증한다.
 * 실제 Firestore 조회(guardianLinkRepository.ts)와 UI 연결(guardianStore.ts)은
 * 실기기 E2E 로 검증한다 — 이 스크립트의 범위 아님.
 *
 * 가장 중요한 계약: 링크가 없거나 전부 비활성이면 selectActiveLink() 는 **null** 을
 * 반환해야 한다 — 절대 개발용 고정 대상으로 조용히 fallback 하면 안 된다(보안 경계).
 */

import assert from 'node:assert/strict';

import {
  buildGuardianLinkId,
  parseGuardianLinkDoc,
  selectActiveLink,
} from '../src/services/guardianLink.ts';

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('buildGuardianLinkId — {uid}_{careRecipientId} 결정론적 조합', () => {
  assert.equal(buildGuardianLinkId('uid1', 'dev-care-recipient'), 'uid1_dev-care-recipient');
  assert.equal(
    buildGuardianLinkId('uid1', 'dev-care-recipient'),
    buildGuardianLinkId('uid1', 'dev-care-recipient'),
  );
});

check('buildGuardianLinkId — 공백 trim', () => {
  assert.equal(buildGuardianLinkId('  uid1  ', '  rid1  '), 'uid1_rid1');
});

check('buildGuardianLinkId — guardianUid / careRecipientId 없으면 throw', () => {
  assert.throws(() => buildGuardianLinkId('', 'rid1'), /guardianUid/);
  assert.throws(() => buildGuardianLinkId('uid1', ''), /careRecipientId/);
  assert.throws(() => buildGuardianLinkId('   ', 'rid1'), /guardianUid/);
});

check('parseGuardianLinkDoc — 정상 문서 → GuardianLinkDoc', () => {
  const d = parseGuardianLinkDoc({
    guardianUid: 'uid1',
    careRecipientId: 'dev-care-recipient',
    role: 'guardian',
    enabled: true,
  });
  assert.deepEqual(d, {
    guardianUid: 'uid1',
    careRecipientId: 'dev-care-recipient',
    role: 'guardian',
    enabled: true,
  });
});

check('parseGuardianLinkDoc — enabled 없으면 활성으로 간주 (pushTokenStore.js 와 동일 패턴)', () => {
  const d = parseGuardianLinkDoc({ guardianUid: 'uid1', careRecipientId: 'rid1' });
  assert.equal(d.enabled, true);
});

check('parseGuardianLinkDoc — enabled:false 는 그대로 보존', () => {
  const d = parseGuardianLinkDoc({ guardianUid: 'uid1', careRecipientId: 'rid1', enabled: false });
  assert.equal(d.enabled, false);
});

check('parseGuardianLinkDoc — guardianUid / careRecipientId 누락/malformed → null', () => {
  assert.equal(parseGuardianLinkDoc({ careRecipientId: 'rid1' }), null);
  assert.equal(parseGuardianLinkDoc({ guardianUid: 'uid1' }), null);
  assert.equal(parseGuardianLinkDoc({ guardianUid: 123, careRecipientId: 'rid1' }), null);
  assert.equal(parseGuardianLinkDoc({}), null);
});

check('selectActiveLink — 링크 없음 → null (dev-care-recipient 로 fallback 하지 않는다)', () => {
  assert.equal(selectActiveLink([]), null);
});

check('selectActiveLink — 전부 enabled:false → null', () => {
  const links = [
    { guardianUid: 'uid1', careRecipientId: 'rid1', enabled: false },
    { guardianUid: 'uid1', careRecipientId: 'rid2', enabled: false },
  ];
  assert.equal(selectActiveLink(links), null);
});

check('selectActiveLink — 활성 링크 1개 → 그 링크', () => {
  const links = [{ guardianUid: 'uid1', careRecipientId: 'dev-care-recipient', enabled: true }];
  assert.deepEqual(selectActiveLink(links), links[0]);
});

check('selectActiveLink — 여러 활성 링크 → careRecipientId 오름차순 1번째 (결정론적)', () => {
  const links = [
    { guardianUid: 'uid1', careRecipientId: 'zzz', enabled: true },
    { guardianUid: 'uid1', careRecipientId: 'aaa', enabled: true },
  ];
  assert.equal(selectActiveLink(links).careRecipientId, 'aaa');
  // 입력 순서를 바꿔도 같은 결과 (정렬 기반, 배열 순서에 의존하지 않음).
  assert.equal(selectActiveLink([...links].reverse()).careRecipientId, 'aaa');
});

check('selectActiveLink — enabled:false 는 후보에서 제외되고 나머지 중 결정론적 선택', () => {
  const links = [
    { guardianUid: 'uid1', careRecipientId: 'aaa', enabled: false },
    { guardianUid: 'uid1', careRecipientId: 'bbb', enabled: true },
  ];
  assert.equal(selectActiveLink(links).careRecipientId, 'bbb');
});

console.log('Phase 5 STEP 5.2 — guardianLinks 도메인 smoke');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
