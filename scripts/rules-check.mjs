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

check('devices 블록의 update 허용 필드는 lastEventAt / lastHeartbeatAt 뿐', () => {
  const m = src.match(/match \/devices\/\{deviceId\}\s*{([\s\S]*?)\n {4}}/);
  assert.ok(m, 'devices 블록을 찾을 수 없음');
  const allowed = new Set();
  for (const h of m[1].matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) {
    for (const f of h[1].split(',')) {
      const t = f.trim().replace(/^'|'$/g, '');
      if (t) allowed.add(t);
    }
  }
  assert.deepEqual([...allowed].sort(), ['lastEventAt', 'lastHeartbeatAt']);
});

check('디바이스 핵심 레지스트리 필드는 어떤 hasOnly 목록에도 없다', () => {
  const allowedFields = new Set();
  for (const m of src.matchAll(/hasOnly\(\[([^\]]*)\]\)/g)) {
    for (const f of m[1].split(',')) {
      const t = f.trim().replace(/^'|'$/g, '');
      if (t) allowedFields.add(t);
    }
  }
  // careRecipientId 는 devices / pushTokens 어느 쪽에서도 클라이언트가 못 바꾼다
  for (const core of ['careRecipientId', 'type', 'location', 'name', 'createdAt']) {
    assert.ok(
      !allowedFields.has(core),
      `필드 ${core} 가 클라이언트 변경 허용 목록에 있음`,
    );
  }
});

check('careRecipients / events update·delete 는 여전히 잠겨 있다', () => {
  assert.ok(/match \/careRecipients\/\{careRecipientId\}\s*{[\s\S]*?allow write: if false/.test(src));
  assert.ok(/match \/events\/\{eventId\}\s*{[\s\S]*?allow update, delete: if false/.test(src));
});

check('careStatus 는 파생 데이터 전용 컬렉션 (Phase 4.3 B-2, delete 잠금)', () => {
  const m = src.match(/match \/careStatus\/\{careRecipientId\}\s*{([\s\S]*?)\n {4}}/);
  assert.ok(m, 'careStatus 블록을 찾을 수 없음');
  const block = m[1];
  assert.ok(/allow read: if true/.test(block), 'careStatus read 허용 없음');
  assert.ok(/allow create, update: if true/.test(block), 'Worker 계산 결과 write 허용 없음');
  assert.ok(/allow delete: if false/.test(block), 'careStatus delete 는 잠겨 있어야 함');
  // careStatus 는 필드 화이트리스트(hasOnly)를 쓰지 않는다 — 서버가 전체 문서를 replace 한다.
  assert.ok(!/hasOnly/.test(block), 'careStatus 블록에 예상치 못한 hasOnly');
});

check('pushTokens 블록 (Phase 4.4 STEP 1) — create 허용, update 는 hasOnly, delete 잠금', () => {
  const m = src.match(/match \/pushTokens\/\{tokenId\}\s*{([\s\S]*?)\n {4}}/);
  assert.ok(m, 'pushTokens 블록을 찾을 수 없음');
  const block = m[1];
  assert.ok(/allow read: if true/.test(block), 'pushTokens read 허용 없음 (Worker 조회)');
  assert.ok(/allow create: if true/.test(block), 'pushTokens create 허용 없음 (앱 등록)');
  assert.ok(/allow update: if/.test(block) && /hasOnly\(/.test(block), 'pushTokens update 는 hasOnly 여야 함');
  assert.ok(/'token'/.test(block) && /'enabled'/.test(block), 'token / enabled 갱신 허용 없음');
  assert.ok(!/'careRecipientId'/.test(block), 'careRecipientId 는 갱신 허용 목록에 없어야 함');
  assert.ok(/allow delete: if false/.test(block), 'pushTokens delete 는 잠겨 있어야 함');
});

check('guardianLinks 블록 (Phase 5 STEP 5.2) — 로그인 + 소유자만 read, write 전부 잠금', () => {
  const m = src.match(/match \/guardianLinks\/\{linkId\}\s*{([\s\S]*?)\n {4}}/);
  assert.ok(m, 'guardianLinks 블록을 찾을 수 없음');
  const block = m[1];
  assert.ok(/allow read: if/.test(block), 'guardianLinks read 규칙 없음');
  assert.ok(!/allow read: if true/.test(block), 'guardianLinks read 가 열려있으면 안 됨(DEVELOPMENT ONLY 아님)');
  assert.ok(/request\.auth\s*!=\s*null/.test(block), 'guardianLinks read 는 로그인(request.auth != null) 을 요구해야 함');
  assert.ok(
    /request\.auth\.uid\s*==\s*resource\.data\.guardianUid/.test(block),
    'guardianLinks read 는 request.auth.uid == resource.data.guardianUid (소유자 검증) 여야 함',
  );
  assert.ok(
    /allow create, update, delete: if false/.test(block),
    'guardianLinks create/update/delete 는 전부 잠겨 있어야 함 (앱은 만들지 않는다)',
  );
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
