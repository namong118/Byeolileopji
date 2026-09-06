/**
 * firestore.rules 정적 구조 검사 (완전한 rules 유닛 테스트가 아님).
 *
 * 이 환경에는 Java / firebase-tools / Firestore 에뮬레이터가 없어
 * @firebase/rules-unit-testing 기반 자동 테스트를 돌릴 수 없다.
 * → 여기서는 "실수로 위험한 규칙이 들어갔는지" 만 정적으로 확인한다.
 * → 의미 검증은 Firebase Console > Firestore > 규칙 Playground 에서 수동으로 한다
 *   (README "Phase 4.1a — Firestore rules" 절 참고).
 *
 * 실행:  node scripts/rules-check.mjs   (npm run test:smoke 에 포함)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

const raw = fs.readFileSync(
  new URL('../firestore.rules', import.meta.url),
  'utf8',
);
// 주석(//...) 을 제거해 실제 규칙 코드만 검사한다
const src = raw.replace(/\/\/[^\n]*/g, '');

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('중괄호 균형', () => {
  const open = (src.match(/{/g) || []).length;
  const close = (src.match(/}/g) || []).length;
  assert.equal(open, close);
});

check('전체 DB 와일드카드(match /{document=**}) 를 쓰지 않는다', () => {
  assert.ok(!/match\s+\/\{document=\*\*\}/.test(src));
});

check('devices update 는 lastEventAt / lastHeartbeatAt 만 허용 (hasOnly)', () => {
  const m = src.match(/match \/devices\/\{deviceId\}\s*{([\s\S]*?)\n {4}}/);
  assert.ok(m, 'devices 블록을 찾을 수 없음');
  const block = m[1];
  assert.ok(/allow update:/.test(block), 'devices update 규칙 없음');
  assert.ok(/hasOnly\(\[[^\]]*\]\)/.test(block), 'devices update 는 hasOnly 여야 함');
  assert.ok(/'lastEventAt'/.test(block), 'lastEventAt 허용 없음');
  assert.ok(/'lastHeartbeatAt'/.test(block), 'lastHeartbeatAt 허용 없음 (Phase 4.1b)');
  assert.ok(/allow create, delete: if false/.test(block));
});

check('devices 핵심 레지스트리 필드는 어떤 allow 목록에도 없다', () => {
  // hasOnly([...]) 안에 나온 필드만 클라이언트가 바꿀 수 있다
  const allowedFields = new Set();
  for (const m of src.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) {
    for (const f of m[1].split(',')) {
      const t = f.trim().replace(/^'|'$/g, '');
      if (t) allowedFields.add(t);
    }
  }
  for (const core of ['careRecipientId', 'enabled', 'type', 'location', 'name']) {
    assert.ok(
      !allowedFields.has(core),
      `핵심 필드 ${core} 가 클라이언트 변경 허용 목록에 있음`,
    );
  }
  assert.deepEqual([...allowedFields].sort(), ['lastEventAt', 'lastHeartbeatAt']);
});

check('careRecipients / events update·delete 는 여전히 잠겨 있다', () => {
  assert.ok(/match \/careRecipients\/\{careRecipientId\}\s*{[\s\S]*?allow write: if false/.test(src));
  assert.ok(/match \/events\/\{eventId\}\s*{[\s\S]*?allow update, delete: if false/.test(src));
});

check('DEVELOPMENT ONLY 표기가 있다', () => {
  assert.ok(/DEVELOPMENT ONLY/.test(raw));
});

console.log('firestore.rules static check');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
