/**
 * Firestore Rules hardening — 전체 권한 매트릭스 (Phase 5 STEP 5.3-D).
 *
 * `scripts/rules-check.mjs` 는 정적 정규식 검사만 한다 — 실제 `request.auth`,
 * `enabled` 의미론, 문서 간 `get()` 참조는 검증하지 못한다. 이 스크립트는
 * `@firebase/rules-unit-testing` + Firestore 에뮬레이터로 실제 Rules 엔진을 돌려
 * guardianLinks / events / careRecipients / careStatus / devices / pushTokens
 * 전체에 대해 ALLOW/DENY 매트릭스를 검증한다.
 *
 * (Phase 5.2 의 `phase5-guardianlinks-rules-emulator-test.mjs` 를 흡수·대체한다 —
 *  guardianLinks 시나리오도 아래에 전부 포함돼 있다.)
 *
 * 실행 (emulator 자동 기동/종료):
 *   npm run test:rules:emulator
 *
 * ⚠️ firebase-tools 최신(15.x)은 Firestore 에뮬레이터 실행에 Java 21+ 을 요구한다.
 *    이 환경은 Java 17(Temurin) 이라 `firebase-tools@13` (Java 17 호환, 실제 검증됨)
 *    으로 고정했다 — package.json 의 test:rules:emulator 참고.
 *
 * ⚠️ test:smoke 체인에는 포함하지 않는다 — JVM 기동이 필요해 smoke 의 "빠르고
 *    의존성 없음" 성격과 맞지 않는다. Firestore Rules 를 고칠 때마다 별도로 실행한다.
 *
 * ⚠️ Worker 경로는 이 테스트의 대상이 아니다 — Worker 는 service-account OAuth2
 *    Bearer 인증 요청이라 이 Rules 를 완전히 우회하는 Admin 경로로 동작한다
 *    (Phase 5.3-A/B 에서 이미 production 으로 검증됨). 여기서는 client(앱) SDK 요청만
 *    시뮬레이션한다.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'demo-byeolileopji';

const CARE_RECIPIENT_ID = 'dev-care-recipient';
const OTHER_RECIPIENT_ID = 'other-recipient'; // 아무도 연결되지 않은 대상
const DEVICE_ID = 'dev-device-livingroom';

const UID_A = 'guardian-a'; // CARE_RECIPIENT_ID 에 linked + enabled
const UID_B = 'guardian-b'; // 아무 링크도 없음
const UID_C = 'guardian-c'; // CARE_RECIPIENT_ID 에 linked 였지만 enabled:false (연결 해제됨)

const LINK_A = `${UID_A}_${CARE_RECIPIENT_ID}`;
const LINK_C = `${UID_C}_${CARE_RECIPIENT_ID}`;

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: fs.readFileSync(
      new URL('../firestore.rules', import.meta.url),
      'utf8',
    ),
  },
});

// Rules 를 우회해 테스트 데이터를 심는다 (Firebase Console 수동 생성 / Worker OAuth
// write 를 흉내낸다 — 실제 프로덕션에서도 이 문서들은 이렇게(무인증 Admin 경로로) 만들어진다).
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await db.collection('guardianLinks').doc(LINK_A).set({
    guardianUid: UID_A,
    careRecipientId: CARE_RECIPIENT_ID,
    role: 'guardian',
    enabled: true,
  });
  await db.collection('guardianLinks').doc(LINK_C).set({
    guardianUid: UID_C,
    careRecipientId: CARE_RECIPIENT_ID,
    role: 'guardian',
    enabled: false, // 연결 해제된 guardian
  });

  await db.collection('careRecipients').doc(CARE_RECIPIENT_ID).set({
    name: 'test-recipient',
  });

  await db.collection('careStatus').doc(CARE_RECIPIENT_ID).set({
    careRecipientId: CARE_RECIPIENT_ID,
    status: 'NORMAL',
    deviceHealth: 'online',
  });

  await db.collection('events').doc('evt1').set({
    careRecipientId: CARE_RECIPIENT_ID,
    eventType: 'motion_detected',
    occurredAt: new Date().toISOString(),
  });

  await db.collection('devices').doc(DEVICE_ID).set({
    careRecipientId: CARE_RECIPIENT_ID,
    enabled: true,
  });

  await db.collection('pushTokens').doc('tokenA').set({
    token: 'tok-A',
    platform: 'android',
    guardianUid: UID_A,
    careRecipientId: CARE_RECIPIENT_ID,
    enabled: true,
  });
  await db.collection('pushTokens').doc('tokenC').set({
    token: 'tok-C',
    platform: 'android',
    guardianUid: UID_C,
    careRecipientId: CARE_RECIPIENT_ID,
    enabled: true,
  });
});

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

function ctxFor(uid) {
  return uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
}

// ═══════════════════════════════════════════════════════════════════════
//  1. 비로그인 — 전부 DENY
// ═══════════════════════════════════════════════════════════════════════

check('[비로그인] events read → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('events').doc('evt1').get());
});

check('[비로그인] events create → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(
    db.collection('events').add({ careRecipientId: CARE_RECIPIENT_ID, eventType: 'motion_detected' }),
  );
});

check('[비로그인] careRecipients read → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('careRecipients').doc(CARE_RECIPIENT_ID).get());
});

check('[비로그인] careStatus read/write → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('careStatus').doc(CARE_RECIPIENT_ID).get());
  await assertFails(
    db.collection('careStatus').doc(CARE_RECIPIENT_ID).set({ status: 'NORMAL' }, { merge: true }),
  );
});

check('[비로그인] devices read/write → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('devices').doc(DEVICE_ID).get());
  await assertFails(
    db.collection('devices').doc(DEVICE_ID).set({ lastHeartbeatAt: new Date() }, { merge: true }),
  );
});

check('[비로그인] pushTokens read/write → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('pushTokens').doc('tokenA').get());
  await assertFails(
    db.collection('pushTokens').doc('tokenX').set({
      token: 't', platform: 'android', guardianUid: 'x', careRecipientId: CARE_RECIPIENT_ID, enabled: true,
    }),
  );
});

check('[비로그인] guardianLinks read → DENY', async () => {
  const db = ctxFor(null).firestore();
  await assertFails(db.collection('guardianLinks').doc(LINK_A).get());
});

// ═══════════════════════════════════════════════════════════════════════
//  2. guardian A — linked + enabled
// ═══════════════════════════════════════════════════════════════════════

check('[A linked] 자기 recipient events read → ALLOW (쿼리)', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(
    db.collection('events').where('careRecipientId', '==', CARE_RECIPIENT_ID).get(),
  );
});

check('[A linked] careRecipients read → ALLOW', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(db.collection('careRecipients').doc(CARE_RECIPIENT_ID).get());
});

check('[A linked] careStatus read → ALLOW', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(db.collection('careStatus').doc(CARE_RECIPIENT_ID).get());
});

check('[A linked] devices read → ALLOW', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(db.collection('devices').doc(DEVICE_ID).get());
});

check('[A linked] events/devices/careStatus client write → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('events').add({ careRecipientId: CARE_RECIPIENT_ID, eventType: 'motion_detected' }),
  );
  await assertFails(
    db.collection('devices').doc(DEVICE_ID).set({ lastHeartbeatAt: new Date() }, { merge: true }),
  );
  await assertFails(
    db.collection('careStatus').doc(CARE_RECIPIENT_ID).set({ status: 'CHECK' }, { merge: true }),
  );
});

check('[A linked] 자기 guardianLink read → ALLOW', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(db.collection('guardianLinks').doc(LINK_A).get());
});

check('[A linked] 자기 pushToken create/update/read → ALLOW', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertSucceeds(db.collection('pushTokens').doc('tokenA').get());
  await assertSucceeds(
    db.collection('pushTokens').doc('tokenA-new').set({
      token: 'tok-A-2', platform: 'android', guardianUid: UID_A, careRecipientId: CARE_RECIPIENT_ID, enabled: true,
    }),
  );
  await assertSucceeds(
    db.collection('pushTokens').doc('tokenA').set({ token: 'tok-A-rotated' }, { merge: true }),
  );
});

// ═══════════════════════════════════════════════════════════════════════
//  3. guardian A — unlinked recipient
// ═══════════════════════════════════════════════════════════════════════

check('[A unlinked] 연결 안 된 recipient 데이터 전부 DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(db.collection('careRecipients').doc(OTHER_RECIPIENT_ID).get());
  await assertFails(db.collection('careStatus').doc(OTHER_RECIPIENT_ID).get());
  await assertFails(
    db.collection('events').where('careRecipientId', '==', OTHER_RECIPIENT_ID).get(),
  );
});

check('[A unlinked] 연결 안 된 recipient 로 pushToken create → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenA-other').set({
      token: 't', platform: 'android', guardianUid: UID_A, careRecipientId: OTHER_RECIPIENT_ID, enabled: true,
    }),
  );
});

// ═══════════════════════════════════════════════════════════════════════
//  4. guardian B — A 의 recipient 와 무관
// ═══════════════════════════════════════════════════════════════════════

check('[B] guardian A 의 recipient 데이터 DENY', async () => {
  const db = ctxFor(UID_B).firestore();
  await assertFails(db.collection('careRecipients').doc(CARE_RECIPIENT_ID).get());
  await assertFails(db.collection('careStatus').doc(CARE_RECIPIENT_ID).get());
  await assertFails(db.collection('devices').doc(DEVICE_ID).get());
});

check('[B] guardian A 의 pushToken read/update → DENY', async () => {
  const db = ctxFor(UID_B).firestore();
  await assertFails(db.collection('pushTokens').doc('tokenA').get());
  await assertFails(
    db.collection('pushTokens').doc('tokenA').set({ enabled: false }, { merge: true }),
  );
});

check('[B] guardian A 의 guardianLink read → DENY', async () => {
  const db = ctxFor(UID_B).firestore();
  await assertFails(db.collection('guardianLinks').doc(LINK_A).get());
});

// ═══════════════════════════════════════════════════════════════════════
//  5. disabled guardianLink (guardian C — 연결 해제됨)
// ═══════════════════════════════════════════════════════════════════════

check('[C disabled] 자기 guardianLink read → ALLOW (연결 해제 상태를 감지해야 하므로)', async () => {
  const db = ctxFor(UID_C).firestore();
  await assertSucceeds(db.collection('guardianLinks').doc(LINK_C).get());
});

check('[C disabled] events/careRecipient/careStatus/devices read → DENY', async () => {
  const db = ctxFor(UID_C).firestore();
  await assertFails(db.collection('careRecipients').doc(CARE_RECIPIENT_ID).get());
  await assertFails(db.collection('careStatus').doc(CARE_RECIPIENT_ID).get());
  await assertFails(db.collection('devices').doc(DEVICE_ID).get());
  await assertFails(
    db.collection('events').where('careRecipientId', '==', CARE_RECIPIENT_ID).get(),
  );
});

check('[C disabled] pushToken create/update → DENY', async () => {
  const db = ctxFor(UID_C).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenC-new').set({
      token: 't', platform: 'android', guardianUid: UID_C, careRecipientId: CARE_RECIPIENT_ID, enabled: true,
    }),
  );
  await assertFails(
    db.collection('pushTokens').doc('tokenC').set({ token: 'rotated' }, { merge: true }),
  );
});

// ═══════════════════════════════════════════════════════════════════════
//  6. spoofing
// ═══════════════════════════════════════════════════════════════════════

check('[spoof] guardianUid 위조(다른 사람 명의로 create) → DENY', async () => {
  const db = ctxFor(UID_B).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenB-spoof').set({
      token: 't', platform: 'android', guardianUid: UID_A, careRecipientId: CARE_RECIPIENT_ID, enabled: true,
    }),
  );
});

check('[spoof] careRecipientId 위조(연결 안 된 대상으로 create) → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenA-spoof').set({
      token: 't', platform: 'android', guardianUid: UID_A, careRecipientId: OTHER_RECIPIENT_ID, enabled: true,
    }),
  );
});

check('[spoof] update 으로 token 소유자(guardianUid) 변경 → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenA').set({ guardianUid: UID_B }, { merge: true }),
  );
});

check('[spoof] update 으로 token 의 careRecipientId 변경 → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('pushTokens').doc('tokenA').set({ careRecipientId: OTHER_RECIPIENT_ID }, { merge: true }),
  );
});

// ═══════════════════════════════════════════════════════════════════════
//  7. guardianLinks mutation — 로그인한 소유자라도 전부 DENY (Phase 5.2 회귀)
// ═══════════════════════════════════════════════════════════════════════

check('[guardianLinks] 로그인한 소유자라도 create/update/delete → DENY', async () => {
  const db = ctxFor(UID_A).firestore();
  await assertFails(
    db.collection('guardianLinks').doc(`${UID_A}_${OTHER_RECIPIENT_ID}`).set({
      guardianUid: UID_A, careRecipientId: OTHER_RECIPIENT_ID, enabled: true,
    }),
  );
  await assertFails(
    db.collection('guardianLinks').doc(LINK_A).set({ enabled: false }, { merge: true }),
  );
  await assertFails(db.collection('guardianLinks').doc(LINK_A).delete());
});

console.log('Phase 5 STEP 5.3-D — Firestore Rules hardening 에뮬레이터 전체 매트릭스');
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
