/**
 * firestore.rules 정적 구조 검사 (완전한 rules 유닛 테스트가 아님).
 *
 * Phase 5 STEP 5.3-D — Rules hardening 이후 버전.
 * 여기서는 "실수로 위험한(열린) 규칙이 들어갔는지" 만 정적으로 확인한다.
 * 실제 request.auth/enabled 의미론(ALLOW/DENY 매트릭스)은 Firestore 에뮬레이터
 * 기반 테스트(scripts/phase53-rules-hardening-emulator-test.mjs,
 * `npm run test:rules:emulator` 로 실행)로 검증한다.
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

/** `match /X/{y} { ... }` 블록 본문만 뽑아낸다 (중첩 없는 최상위 컬렉션 블록 전제). */
function collectionBlock(name, param) {
  const re = new RegExp(
    `match \\/${name}\\/\\{${param}\\}\\s*\\{([\\s\\S]*?)\\n {4}\\}`,
  );
  const m = src.match(re);
  return m ? m[1] : null;
}

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

check('열린 규칙(allow ...: if true) 이 어디에도 남아있지 않다', () => {
  assert.ok(
    !/allow\s+[\w,\s]+:\s*if\s+true/.test(src),
    'DEVELOPMENT ONLY 시절의 `if true` 가 아직 남아있음',
  );
});

check('isSignedIn() / isGuardianOf() 헬퍼가 정의돼 있다', () => {
  assert.match(src, /function isSignedIn\(\)/);
  assert.match(src, /function isGuardianOf\(careRecipientId\)/);
});

check('isGuardianOf() — 단순 exists() 만이 아니라 guardianLinks.enabled == true 를 실제로 검사한다', () => {
  const m = src.match(/function isGuardianOf\(careRecipientId\)\s*\{([\s\S]*?)\n {4}\}/);
  assert.ok(m, 'isGuardianOf 함수 본문을 찾을 수 없음');
  const body = m[1];
  assert.match(body, /guardianLinks/, 'guardianLinks 문서를 참조해야 함');
  assert.match(body, /\.data\.enabled\s*==\s*true/, 'enabled == true 검사가 있어야 함');
  assert.match(body, /exists\(/, 'exists() 로 미존재 문서에서의 오류를 방어해야 함');
});

check('guardianLinks 블록 — 자기 문서만 read 허용, mutation 전부 false', () => {
  const block = collectionBlock('guardianLinks', 'linkId');
  assert.ok(block, 'guardianLinks 블록을 찾을 수 없음');
  assert.match(block, /allow read: if/);
  assert.match(block, /request\.auth\.uid\s*==\s*resource\.data\.guardianUid/);
  assert.match(block, /allow create, update, delete: if false/);
  // enabled 여부와 무관하게 자기 링크는 read 되어야 하므로 isGuardianOf() 를 쓰면 안 된다.
  assert.doesNotMatch(block, /isGuardianOf/, 'guardianLinks read 는 isGuardianOf() 에 의존하면 안 됨(연결 해제 감지 불가해짐)');
});

check('events 블록 — read 는 isGuardianOf(), write(client) 는 전부 false', () => {
  const block = collectionBlock('events', 'eventId');
  assert.ok(block, 'events 블록을 찾을 수 없음');
  assert.match(block, /allow read: if isGuardianOf\(resource\.data\.careRecipientId\)/);
  assert.match(block, /allow create, update, delete: if false/);
});

check('careRecipients 블록 — read 는 isGuardianOf(문서 id), write(client) 는 전부 false', () => {
  const block = collectionBlock('careRecipients', 'careRecipientId');
  assert.ok(block, 'careRecipients 블록을 찾을 수 없음');
  assert.match(block, /allow read: if isGuardianOf\(careRecipientId\)/);
  assert.match(block, /allow create, update, delete: if false/);
});

check('careStatus 블록 — read 는 isGuardianOf(문서 id), write(client) 는 전부 false (서버 파생 데이터)', () => {
  const block = collectionBlock('careStatus', 'careRecipientId');
  assert.ok(block, 'careStatus 블록을 찾을 수 없음');
  assert.match(block, /allow read: if isGuardianOf\(careRecipientId\)/);
  assert.match(block, /allow create, update, delete: if false/);
});

check('devices 블록 — read 는 isGuardianOf(resource.data.careRecipientId), write(client) 는 전부 false', () => {
  const block = collectionBlock('devices', 'deviceId');
  assert.ok(block, 'devices 블록을 찾을 수 없음');
  assert.match(block, /allow read: if isGuardianOf\(resource\.data\.careRecipientId\)/);
  assert.match(block, /allow create, update, delete: if false/);
  // Phase 4.1a/4.1b 시절 client(무인증 Worker) hasOnly 허용이 완전히 사라졌는지 확인.
  assert.doesNotMatch(block, /hasOnly/, 'devices 에 예전 client update 허용(hasOnly) 이 남아있으면 안 됨');
});

check('pushTokens 블록 — 소유자(guardianUid) + isGuardianOf 이중 검증, spoof 방지, delete 금지', () => {
  const block = collectionBlock('pushTokens', 'tokenId');
  assert.ok(block, 'pushTokens 블록을 찾을 수 없음');

  assert.match(block, /allow read: if/);
  assert.match(block, /resource\.data\.guardianUid\s*==\s*request\.auth\.uid/, 'read 는 자기 토큰만 허용해야 함');
  assert.match(block, /isGuardianOf\(resource\.data\.careRecipientId\)/, 'read 도 연결 상태를 검사해야 함');

  assert.match(block, /allow create: if/);
  assert.match(
    block,
    /request\.resource\.data\.guardianUid\s*==\s*request\.auth\.uid/,
    'create 는 guardianUid 스푸핑을 막아야 함',
  );
  assert.match(
    block,
    /isGuardianOf\(request\.resource\.data\.careRecipientId\)/,
    'create 는 연결된(enabled) careRecipient 인지 확인해야 함',
  );

  assert.match(block, /allow update: if/);
  assert.match(
    block,
    /request\.resource\.data\.careRecipientId\s*==\s*resource\.data\.careRecipientId/,
    'update 는 careRecipientId 재지정을 막아야 함',
  );
  assert.match(block, /hasOnly\(\[[^\]]*\]\)/, 'update 는 필드 화이트리스트(hasOnly) 여야 함');
  assert.doesNotMatch(
    /allow update:[\s\S]*?allow delete/.exec(block)?.[0] ?? block,
    /'guardianUid'|'careRecipientId'/,
    'guardianUid/careRecipientId 는 update 허용 필드 목록에 없어야 함',
  );

  assert.match(block, /allow delete: if false/, '앱이 delete 를 쓰지 않으므로 최소 권한(false) 이어야 함');
});

check('DEVELOPMENT ONLY 표기가 더 이상 남아있지 않다 (hardening 완료)', () => {
  assert.ok(!/DEVELOPMENT ONLY/.test(raw));
});

console.log('firestore.rules static check');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
