/**
 * Phase 5 STEP 5.1 — Auth 도메인 순수 로직 smoke.
 *
 * 실행:  node scripts/phase5-auth-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * 실제 Firebase 네트워크 호출 / RN 런타임(AsyncStorage 등) 없이, 에러 코드 →
 * 사용자 문구 매핑(src/services/authErrors.ts)만 검증한다. Auth 초기화/구독
 * 자체는 실기기 E2E(로그인 실패/성공/로그아웃)로 검증한다 — 이 스크립트의 범위 아님.
 */

import assert from 'node:assert/strict';

import {
  describeAuthError,
  extractAuthErrorCode,
} from '../src/services/authErrors.ts';

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('extractAuthErrorCode — Firebase 에러 형태({code}) 에서 code 추출', () => {
  assert.equal(extractAuthErrorCode({ code: 'auth/wrong-password' }), 'auth/wrong-password');
});

check('extractAuthErrorCode — code 없음/비-object/null → 빈 문자열', () => {
  assert.equal(extractAuthErrorCode(new Error('boom')), '');
  assert.equal(extractAuthErrorCode('plain string'), '');
  assert.equal(extractAuthErrorCode(null), '');
  assert.equal(extractAuthErrorCode(undefined), '');
});

check('describeAuthError — invalid-credential 계열 → 이메일/비밀번호 문구', () => {
  const msg = '이메일 또는 비밀번호가 올바르지 않아요.';
  assert.equal(describeAuthError({ code: 'auth/invalid-credential' }), msg);
  assert.equal(describeAuthError({ code: 'auth/invalid-email' }), msg);
  assert.equal(describeAuthError({ code: 'auth/user-not-found' }), msg);
  assert.equal(describeAuthError({ code: 'auth/wrong-password' }), msg);
});

check('describeAuthError — too-many-requests → 잠시 후 재시도 문구', () => {
  assert.equal(
    describeAuthError({ code: 'auth/too-many-requests' }),
    '잠시 후 다시 시도해 주세요.',
  );
});

check('describeAuthError — 알 수 없는 코드/에러 → 일반 실패 문구, 코드 자체는 노출 안 함', () => {
  const fallback = '로그인에 실패했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.';
  assert.equal(describeAuthError({ code: 'auth/network-request-failed' }), fallback);
  assert.equal(describeAuthError(new Error('unexpected')), fallback);
  assert.equal(describeAuthError(undefined), fallback);
});

console.log('Phase 5 STEP 5.1 — Auth 도메인 smoke');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
