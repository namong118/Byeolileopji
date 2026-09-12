/**
 * guardianLinks 규칙 — Firestore 에뮬레이터 기반 ALLOW/DENY 검증 (Phase 5 STEP 5.2).
 *
 * `scripts/rules-check.mjs` 는 정적 정규식 검사만 한다 — `request.auth.uid ==
 * resource.data.guardianUid` 같은 실제 의미론은 검증하지 못한다. 이 스크립트는
 * `@firebase/rules-unit-testing` + Firestore 에뮬레이터로 실제 Rules 엔진을 돌려
 * 아래 매트릭스를 검증한다:
 *
 *   - 비로그인 read                              → DENY
 *   - guardianUid == 로그인 uid 인 문서 read      → ALLOW
 *   - guardianUid != 로그인 uid 인 문서 read      → DENY
 *   - create / update / delete (로그인 상태 포함) → DENY (앱은 만들지 않는다)
 *
 * 실행 (emulator 자동 기동/종료):
 *   npm run test:rules:emulator
 *
 * ⚠️ firebase-tools 최신(15.x)은 Firestore 에뮬레이터 실행에 Java 21+ 을 요구한다.
 *    이 환경은 Java 17(Temurin) 이라 `firebase-tools@13` (Java 17 호환, 실제 검증됨)
 *    으로 고정했다 — package.json 의 test:rules:emulator 참고. 로컬 JDK 를 21+ 로
 *    올리면 최신 firebase-tools 로 바꿔도 된다 (필수 아님).
 *
 * ⚠️ test:smoke 체인에는 포함하지 않는다 — JVM 기동이 필요해 smoke 의 "빠르고
 *    의존성 없음" 성격과 맞지 않는다 (rules-check.mjs 의 기존 설계 의도와 동일).
 *    Firestore Rules 를 고칠 때마다 별도로 실행한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-byeolileopji';
const UID_A = 'guardian-a';
const UID_B = 'guardian-b';
const CARE_RECIPIENT_ID = 'dev-care-recipient';
const LINK_ID = `${UID_A}_${CARE_RECIPIENT_ID}`;

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: fs.readFileSync(
      new URL('../firestore.rules', import.meta.url),
      'utf8',
    ),
  },
});

// Rules 를 우회해 테스트 데이터를 심는다 (Firebase Console 수동 생성을 흉내낸다).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx
    .firestore()
    .collection('guardianLinks')
    .doc(LINK_ID)
    .set({
      guardianUid: UID_A,
      careRecipientId: CARE_RECIPIENT_ID,
      role: 'guardian',
      enabled: true,
    });
});

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('비로그인 guardianLinks read → DENY', async () => {
  const unauth = testEnv.unauthenticatedContext();
  await assertFails(
    unauth.firestore().collection('guardianLinks').doc(LINK_ID).get(),
  );
});

check('guardianUid == 로그인 uid → ALLOW', async () => {
  const asA = testEnv.authenticatedContext(UID_A);
  await assertSucceeds(
    asA.firestore().collection('guardianLinks').doc(LINK_ID).get(),
  );
});

check('guardianUid != 로그인 uid (다른 guardian) → DENY', async () => {
  const asB = testEnv.authenticatedContext(UID_B);
  await assertFails(
    asB.firestore().collection('guardianLinks').doc(LINK_ID).get(),
  );
});

check('로그인한 소유자라도 create → DENY (앱은 만들지 않는다)', async () => {
  const asA = testEnv.authenticatedContext(UID_A);
  await assertFails(
    asA
      .firestore()
      .collection('guardianLinks')
      .doc(`${UID_A}_other-recipient`)
      .set({ guardianUid: UID_A, careRecipientId: 'other-recipient', enabled: true }),
  );
});

check('로그인한 소유자라도 update → DENY', async () => {
  const asA = testEnv.authenticatedContext(UID_A);
  await assertFails(
    asA
      .firestore()
      .collection('guardianLinks')
      .doc(LINK_ID)
      .set({ enabled: false }, { merge: true }),
  );
});

check('로그인한 소유자라도 delete → DENY', async () => {
  const asA = testEnv.authenticatedContext(UID_A);
  await assertFails(
    asA.firestore().collection('guardianLinks').doc(LINK_ID).delete(),
  );
});

console.log('Phase 5 STEP 5.2 — guardianLinks Rules 에뮬레이터 검증');
let passed = 0;
try {
  for (const { name, fn } of tests) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  }
} finally {
  await testEnv.cleanup();
}
console.log(`\n${passed} checks passed ✅`);

assert.equal(passed, tests.length);
