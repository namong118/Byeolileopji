/**
 * Phase 5 STEP 5.3-C — Developer Simulation / production 데이터 완전 분리 스모크.
 *
 * 실행:  node scripts/phase53-simulation-isolation-smoke.mjs   (npm run test:smoke 에 포함)
 *
 * ⚠️ 정적 소스 검사다 (rules-check.mjs 와 동일한 접근). 동적 import 로 실행 검증하지
 *    않는 이유: simulationEventService.ts → eventService.ts → lib/firebase.ts 로
 *    이어지는 체인이 `@react-native-async-storage/async-storage`(RN 네이티브 모듈)를
 *    끌어와 순수 Node 스크립트에서 로드할 수 없다(Metro 번들 환경 전용). 앱 자체는
 *    Metro 가 정상 번들하므로 문제 없다 — 이 스크립트는 "소스가 올바른 모듈을
 *    쓰고 있는가" 를 정적으로 확인한다.
 *
 * 검증 대상:
 *   - simulationEventService.ts 가 InMemoryEventRepository 만 쓰고 Firestore 관련
 *     import 가 전혀 없다.
 *   - developer.tsx 의 "이벤트 발생" 버튼이 simulationEventService 를 쓰고,
 *     production 경로(getEventService/careStore.simulateEvent)를 전혀 참조하지 않는다.
 *   - careStore.ts 에는 simulateEvent/actionError 필드/메서드가 더 이상 존재하지 않는다
 *     (production 스토어 자체가 이벤트 write 능력을 갖지 않는다).
 *   - (tabs)/_layout.tsx 와 developer.tsx 양쪽에서 production 빌드 시 개발자 탭이
 *     차단된다(href:null + Redirect).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(relPath) {
  return fs.readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
}

const simulationSrc = read('src/services/simulationEventService.ts');
const developerSrc = read('app/(tabs)/developer.tsx');
const careStoreSrc = read('src/stores/careStore.ts');
const tabsLayoutSrc = read('app/(tabs)/_layout.tsx');

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('simulationEventService.ts — InMemoryEventRepository 만 쓴다', () => {
  assert.match(
    simulationSrc,
    /new EventService\(\s*new InMemoryEventRepository\(\)/,
    'InMemoryEventRepository 로 생성하는 패턴이 없음',
  );
});

check('simulationEventService.ts — Firestore/Firebase 관련 import 가 전혀 없다', () => {
  assert.doesNotMatch(simulationSrc, /FirestoreEventRepository/);
  assert.doesNotMatch(simulationSrc, /getFirestoreDb/);
  assert.doesNotMatch(simulationSrc, /firebase\/firestore/);
  assert.doesNotMatch(simulationSrc, /from ['"]\.\.\/lib\/firebase['"]/);
});

check('developer.tsx — 이벤트 발생 버튼이 simulationEventService 를 쓴다', () => {
  assert.match(
    developerSrc,
    /import\s*\{\s*simulationEventService\s*\}\s*from\s*['"]\.\.\/\.\.\/src\/services\/simulationEventService['"]/,
    'simulationEventService import 없음',
  );
  assert.match(
    developerSrc,
    /simulationEventService\.recordEvent\(/,
    '버튼 핸들러가 simulationEventService.recordEvent 를 호출하지 않음',
  );
});

check('developer.tsx — production 이벤트 write 경로(getEventService/careStore.simulateEvent)를 전혀 참조하지 않는다', () => {
  assert.doesNotMatch(developerSrc, /getEventService/);
  assert.doesNotMatch(developerSrc, /\bsimulateEvent\b/);
});

check('careStore.ts — simulateEvent / actionError 필드·메서드가 존재하지 않는다 (production 스토어에 이벤트 write 능력 없음)', () => {
  assert.doesNotMatch(careStoreSrc, /simulateEvent\s*[:(]/);
  assert.doesNotMatch(careStoreSrc, /actionError\??\s*:/);
});

check('(tabs)/_layout.tsx — developer 탭은 production 빌드에서 href:null 로 숨긴다', () => {
  const m = tabsLayoutSrc.match(/name="developer"[\s\S]*?options=\{\{([\s\S]*?)\}\}/);
  assert.ok(m, 'developer Tabs.Screen 블록을 찾을 수 없음');
  assert.match(m[1], /href:\s*__DEV__\s*\?\s*undefined\s*:\s*null/, 'href __DEV__ 조건 분기 없음');
});

check('developer.tsx — __DEV__ 아니면 화면 자체를 Redirect 한다 (딥링크 차단)', () => {
  assert.match(developerSrc, /import\s*\{\s*Redirect\s*\}\s*from\s*['"]expo-router['"]/);
  assert.match(developerSrc, /if\s*\(!__DEV__\)\s*\{\s*return\s*<Redirect/);
});

console.log('Phase 5 STEP 5.3-C — Developer Simulation 격리 smoke (정적 검사)');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
