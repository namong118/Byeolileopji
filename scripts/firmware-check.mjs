/**
 * esp32-pir.ino 정적 구조 검사 (완전한 컴파일이 아님).
 *
 * 실제 컴파일은 Arduino IDE / xtensa-esp-elf-g++ 로 사용자가 확인한다.
 * 여기서는 회귀(중괄호 깨짐 / setup·loop 누락 / motion·heartbeat 경로 손상 /
 * 임시 진단 코드 잔존)를 막는다.
 *
 * PIR 실물 E2E 검증 완료 후: setup() 의 부팅 TEMP TEST 블록과 GPIO4 TEMP DEBUG 를
 * 제거했다. 이 검사기는 그것들이 다시 들어오지 않는지 확인한다.
 *
 * 실행:  node scripts/firmware-check.mjs   (npm run test:smoke 에 포함)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

const raw = fs.readFileSync(
  new URL('../firmware/esp32-pir/esp32-pir.ino', import.meta.url),
  'utf8',
);
// 블록/라인 주석 + 문자열 리터럴 제거 후 구조만 검사
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')
  .replace(/"(\\.|[^"\\])*"/g, '""')
  .replace(/'(\\.|[^'\\])*'/g, "''");

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

check('중괄호 / 괄호 균형', () => {
  const n = (s, ch) => (s.match(new RegExp('\\' + ch, 'g')) || []).length;
  assert.equal(n(code, '{'), n(code, '}'), '{ } 불균형');
  assert.equal(n(code, '('), n(code, ')'), '( ) 불균형');
});

check('필수 함수 정의 각 1회 (setup / loop / wifiConnect / postEvent / handlePir)', () => {
  for (const sig of ['void setup()', 'void loop()', 'void wifiConnect()', 'int postEvent(', 'void handlePir()']) {
    assert.equal(raw.split(sig).length - 1, 1, `${sig} 정의가 정확히 1개가 아님`);
  }
});

check('Phase 4.1b: sendHeartbeat / handleHeartbeat 정의 존재', () => {
  assert.equal(raw.split('int sendHeartbeat()').length - 1, 1);
  assert.equal(raw.split('void handleHeartbeat()').length - 1, 1);
});

check('loop() 가 handlePir() 와 handleHeartbeat() 를 모두 호출한다', () => {
  const loopBody = raw.slice(raw.indexOf('void loop()'));
  assert.ok(/handlePir\(\);/.test(loopBody), 'loop 에서 handlePir() 호출 없음');
  assert.ok(/handleHeartbeat\(\);/.test(loopBody), 'loop 에서 handleHeartbeat() 호출 없음');
  assert.ok(/wifiConnect\(\);/.test(loopBody), 'loop 에서 wifiConnect() 호출 없음');
  assert.ok(!/handlePirDebug\(\);/.test(loopBody), 'loop 에 TEMP DEBUG 호출이 남아 있음');
});

check('motion 경로 (handlePir: 상승 에지 → cooldown → postEvent("motion_detected"))', () => {
  const pirBody = raw.slice(raw.indexOf('void handlePir()'), raw.indexOf('void setup()'));
  assert.ok(/postEvent\("motion_detected"\)/.test(pirBody));
  assert.ok(/MOTION_COOLDOWN_MS/.test(pirBody), '쿨다운 로직 유지');
  assert.ok(/lastPirState == LOW/.test(pirBody), '상승 에지 로직 유지');
});

check('PIR pin 은 GPIO4 (config.h PIR_PIN 4) + 펌웨어는 PIR_PIN 사용', () => {
  const cfg = fs.readFileSync(
    new URL('../firmware/esp32-pir/config.h', import.meta.url),
    'utf8',
  );
  assert.ok(/#define\s+PIR_PIN\s+4\b/.test(cfg), 'config.h PIR_PIN 이 4 가 아님');
  assert.ok(/digitalRead\(PIR_PIN\)/.test(raw), 'digitalRead(PIR_PIN) 없음');
  assert.ok(/pinMode\(PIR_PIN,\s*INPUT\)/.test(raw), 'pinMode(PIR_PIN, INPUT) 없음');
});

check('PIR warmup 유지 (PIR_WARMUP_MS)', () => {
  assert.ok(/PIR_WARMUP_MS/.test(raw), 'PIR_WARMUP_MS 참조 없음');
  assert.ok(/warmup done, sensing active/.test(raw), 'warmup 완료 로그 없음');
});

check('임시 진단 코드 없음 — 부팅 TEMP TEST 제거됨 (PIR 실물 E2E 완료)', () => {
  assert.ok(!/TEMP TEST/.test(raw), 'TEMP TEST 마커가 아직 있음');
  assert.ok(!/\[TEST\]/.test(raw), '[TEST] 로그가 아직 있음');
  // setup() 이 부팅당 이벤트를 보내지 않는다
  const setupBody = raw.slice(raw.indexOf('void setup()'), raw.indexOf('void loop()'));
  assert.ok(!/postEvent\(/.test(setupBody), 'setup() 이 아직 postEvent 를 호출함');
});

check('임시 진단 코드 없음 — GPIO4 TEMP DEBUG 제거됨', () => {
  assert.ok(!/TEMP DEBUG/.test(raw), 'TEMP DEBUG 마커가 아직 있음');
  assert.ok(!/\[PIR DEBUG\]/.test(raw), '[PIR DEBUG] 로그가 아직 있음');
  assert.ok(!/handlePirDebug/.test(raw), 'handlePirDebug 가 아직 있음');
});

check('heartbeat 는 config.h 상수를 쓴다 (하드코딩 30초 아님)', () => {
  assert.ok(/HEARTBEAT_INTERVAL_MS/.test(raw));
  assert.ok(/HEARTBEAT_MAX_RETRIES/.test(raw));
});

check('config.h HEARTBEAT_INTERVAL_MS 기본값이 짧지 않다 (>= 60초)', () => {
  const cfg = fs.readFileSync(
    new URL('../firmware/esp32-pir/config.h', import.meta.url),
    'utf8',
  );
  const m = cfg.match(/#define\s+HEARTBEAT_INTERVAL_MS\s+(\d+)UL/);
  assert.ok(m, 'HEARTBEAT_INTERVAL_MS 정의 없음');
  assert.ok(Number(m[1]) >= 60000, `기본값 ${m[1]}ms 가 너무 짧음 (테스트값 커밋 금지)`);
});

check('secrets.example.h 에 HEARTBEAT_URL 템플릿 존재 (실제 secrets.h 아님)', () => {
  const ex = fs.readFileSync(
    new URL('../firmware/esp32-pir/secrets.example.h', import.meta.url),
    'utf8',
  );
  assert.ok(/#define\s+HEARTBEAT_URL\s+"https:\/\/[^"]*\/device-heartbeat"/.test(ex));
});

console.log('esp32-pir.ino static check');
let passed = 0;
for (const { name, fn } of tests) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
