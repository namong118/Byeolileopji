/**
 * Phase 2 스모크 테스트 — 외부 의존성/DB 없이 순수 매핑·필터 로직만 검증한다.
 *
 * 실행:  node scripts/phase2-smoke.mjs
 *
 * (jest-expo 도입은 현재 프로젝트 규모 대비 과해서, Phase 1 과 동일하게
 *  Node 내장 TS 실행으로 순수 함수만 확인한다. 자세한 이유는 README 참고.)
 */

import assert from 'node:assert/strict';

import {
  rowToCareEvent,
  newCareEventToInsert,
  careEventToInsert,
} from '../src/services/supabase/eventMapper.ts';
import { isSameDay } from '../src/utils/time.ts';
import { presentEvent } from '../src/utils/eventPresenter.ts';
import { InMemoryEventRepository } from '../src/services/eventRepository.ts';

const tests = [];
function check(name, fn) {
  tests.push({ name, fn });
}

// ── 1. DB row -> CareEvent 매핑 ───────────────────────────────────────────
check('rowToCareEvent: snake_case -> camelCase, UTC 유지', () => {
  const row = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    care_recipient_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222',
    event_type: 'motion_detected',
    source: 'sensor',
    location: '거실',
    payload: {},
    occurred_at: '2026-09-03T07:32:00.000Z',
    created_at: '2026-09-03T07:32:01.000Z',
  };
  const ev = rowToCareEvent(row);
  assert.equal(ev.id, row.id);
  assert.equal(ev.eventType, 'motion_detected');
  assert.equal(ev.source, 'sensor');
  assert.equal(ev.location, '거실');
  assert.equal(ev.careRecipientId, row.care_recipient_id);
  assert.equal(ev.deviceId, row.device_id);
  assert.equal(ev.occurredAt, '2026-09-03T07:32:00.000Z');
  assert.equal(ev.metadata, undefined); // 빈 payload 는 undefined
});

check('rowToCareEvent: null device_id / location -> undefined', () => {
  const ev = rowToCareEvent({
    id: 'id1',
    care_recipient_id: 'cr1',
    device_id: null,
    event_type: 'medication_taken',
    source: 'medication',
    location: null,
    payload: { note: 'x' },
    occurred_at: '2026-09-03T00:00:00.000Z',
    created_at: '2026-09-03T00:00:00.000Z',
  });
  assert.equal(ev.deviceId, undefined);
  assert.equal(ev.location, undefined);
  assert.deepEqual(ev.metadata, { note: 'x' });
});

check('rowToCareEvent: 알 수 없는 event_type 은 안전하게 폴백', () => {
  const ev = rowToCareEvent({
    id: 'id2',
    care_recipient_id: 'cr1',
    device_id: null,
    event_type: 'something_new',
    source: 'weird',
    location: null,
    payload: {},
    occurred_at: '2026-09-03T00:00:00.000Z',
    created_at: '2026-09-03T00:00:00.000Z',
  });
  assert.equal(ev.eventType, 'motion_detected');
  assert.equal(ev.source, 'system');
});

// ── 2. CareEvent -> DB insert payload ────────────────────────────────────
check('newCareEventToInsert: id/created_at 없음, fallback recipient 적용', () => {
  const insert = newCareEventToInsert(
    { eventType: 'motion_detected', source: 'sensor', location: '거실' },
    'fallback-cr',
  );
  assert.equal(insert.care_recipient_id, 'fallback-cr');
  assert.equal(insert.event_type, 'motion_detected');
  assert.equal(insert.source, 'sensor');
  assert.equal(insert.location, '거실');
  assert.deepEqual(insert.payload, {});
  assert.ok(insert.occurred_at, 'occurred_at 자동 채움');
  assert.ok(!('id' in insert));
  assert.ok(!('created_at' in insert));
});

check('careEventToInsert: 도메인 이벤트를 그대로 row 형태로', () => {
  const insert = careEventToInsert({
    id: 'local-1',
    eventType: 'sos_triggered',
    source: 'watch',
    occurredAt: '2026-09-03T10:00:00.000Z',
    careRecipientId: 'cr-9',
    deviceId: undefined,
  });
  assert.equal(insert.care_recipient_id, 'cr-9');
  assert.equal(insert.device_id, null);
  assert.equal(insert.event_type, 'sos_triggered');
  assert.equal(insert.occurred_at, '2026-09-03T10:00:00.000Z');
});

// round-trip: insert -> (가상 DB) row -> domain
check('round-trip: newCareEventToInsert -> row -> rowToCareEvent 일관', () => {
  const insert = newCareEventToInsert(
    { eventType: 'returned_home', source: 'sensor' },
    'cr-rt',
  );
  const row = {
    id: 'generated-uuid',
    created_at: '2026-09-03T12:00:00.000Z',
    ...insert,
    device_id: insert.device_id ?? null,
    location: insert.location ?? null,
    payload: insert.payload ?? {},
  };
  const ev = rowToCareEvent(row);
  assert.equal(ev.eventType, 'returned_home');
  assert.equal(ev.source, 'sensor');
  assert.equal(ev.careRecipientId, 'cr-rt');
});

// ── 3. 오늘 이벤트 필터 ──────────────────────────────────────────────────
check('isSameDay: 오늘/어제 구분', () => {
  const now = new Date('2026-09-03T09:00:00');
  assert.equal(isSameDay(new Date('2026-09-03T23:59:00'), now), true);
  assert.equal(isSameDay(new Date('2026-09-02T23:59:00'), now), false);
});

// ── 4. eventPresenter 기존 동작 유지 ─────────────────────────────────────
check('presentEvent: 기술 용어 없이 한국어 문장', () => {
  const row = rowToCareEvent({
    id: 'p1',
    care_recipient_id: 'cr',
    device_id: null,
    event_type: 'motion_detected',
    source: 'sensor',
    location: '거실',
    payload: {},
    occurred_at: '2026-09-03T07:32:00.000Z',
    created_at: '2026-09-03T07:32:00.000Z',
  });
  const p = presentEvent(row);
  assert.equal(p.message, '거실에서 활동이 확인됐어요.');
  assert.ok(!/motion|PIR|sensor/i.test(p.message));
});

// ── 5. InMemory 폴백 저장소 (Supabase 미설정 시 경로) ────────────────────
check('InMemoryEventRepository: append 는 저장된 이벤트를 반환', async () => {
  const repo = new InMemoryEventRepository();
  const saved = await repo.appendEvent({
    id: 'm1',
    eventType: 'motion_detected',
    source: 'sensor',
    occurredAt: '2026-09-03T08:00:00.000Z',
  });
  assert.equal(saved.id, 'm1');
  const list = await repo.listEvents();
  assert.equal(list.length, 1);
});

check('InMemoryEventRepository: listEvents 는 최신 우선 정렬', async () => {
  const repo = new InMemoryEventRepository();
  await repo.appendEvent({ id: 'a', eventType: 'motion_detected', source: 'sensor', occurredAt: '2026-09-03T08:00:00.000Z' });
  await repo.appendEvent({ id: 'b', eventType: 'motion_detected', source: 'sensor', occurredAt: '2026-09-03T10:00:00.000Z' });
  const list = await repo.listEvents();
  assert.deepEqual(list.map((e) => e.id), ['b', 'a']);
});

console.log('Phase 2 smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
