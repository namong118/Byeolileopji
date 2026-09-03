/**
 * Phase 2.5 스모크 테스트 — 외부 의존성/네트워크 없이 순수 로직만 검증한다.
 *
 * 실행:  node scripts/phase25-smoke.mjs   (또는 npm run test:smoke)
 *
 * jest-expo 는 화면 3개 규모 대비 설정 비용이 커서 도입하지 않는다.
 * Node 내장 TS 실행으로 매핑·타임스탬프 변환·파생 뷰·InMemory 폴백을 확인한다.
 * 화면 로직은 typecheck + Metro 번들이 커버한다.
 */

import assert from 'node:assert/strict';

import {
  docToCareEvent,
  newCareEventToFirestore,
  toIsoString,
} from '../src/mappers/firestoreEventMapper.ts';
import { deriveEventViews } from '../src/services/eventViews.ts';
import { InMemoryEventRepository } from '../src/services/eventRepository.ts';
import { presentEvent } from '../src/utils/eventPresenter.ts';

const tests = [];
const check = (name, fn) => tests.push({ name, fn });

// ── 1. Firestore Timestamp 변환 (여러 형태) ──────────────────────────────
check('toIsoString: Timestamp({toDate}) 형태', () => {
  const target = '2026-09-03T07:32:00.000Z';
  assert.equal(toIsoString({ toDate: () => new Date(target) }), target);
});

check('toIsoString: {seconds} 초 단위 정확 변환', () => {
  const secs = Math.floor(Date.UTC(2026, 8, 3, 7, 32, 0) / 1000);
  assert.equal(toIsoString({ seconds: secs }), '2026-09-03T07:32:00.000Z');
});

check('toIsoString: Date / ISO 문자열 / null 안전', () => {
  assert.equal(toIsoString(new Date('2026-09-03T00:00:00Z')), '2026-09-03T00:00:00.000Z');
  assert.equal(toIsoString('2026-09-03T00:00:00Z'), '2026-09-03T00:00:00.000Z');
  assert.equal(typeof toIsoString(null), 'string'); // 현재 시각으로 폴백
  assert.equal(typeof toIsoString('not-a-date'), 'string');
});

// ── 2. Firestore 문서 -> CareEvent ──────────────────────────────────────
check('docToCareEvent: 문서 id 를 CareEvent.id 로, snake 없이 camel 유지', () => {
  const ev = docToCareEvent('doc_abc123', {
    careRecipientId: 'dev-care-recipient',
    deviceId: 'dev-device-livingroom',
    eventType: 'motion_detected',
    source: 'sensor',
    location: '거실',
    payload: {},
    occurredAt: { toDate: () => new Date('2026-09-03T07:32:00Z') },
    createdAt: { toDate: () => new Date('2026-09-03T07:32:01Z') },
  });
  assert.equal(ev.id, 'doc_abc123');
  assert.equal(ev.eventType, 'motion_detected');
  assert.equal(ev.source, 'sensor');
  assert.equal(ev.location, '거실');
  assert.equal(ev.careRecipientId, 'dev-care-recipient');
  assert.equal(ev.deviceId, 'dev-device-livingroom');
  assert.equal(ev.occurredAt, '2026-09-03T07:32:00.000Z');
  assert.equal(ev.metadata, undefined);
});

check('docToCareEvent: null/누락 필드 안전 처리', () => {
  const ev = docToCareEvent('d1', {
    careRecipientId: 'dev-care-recipient',
    eventType: 'medication_taken',
    source: 'medication',
    location: null,
    payload: { dose: 1 },
    occurredAt: null,
  });
  assert.equal(ev.deviceId, undefined);
  assert.equal(ev.location, undefined);
  assert.deepEqual(ev.metadata, { dose: 1 });
  assert.equal(typeof ev.occurredAt, 'string');
});

check('docToCareEvent: 알 수 없는 enum 은 안전 폴백', () => {
  const ev = docToCareEvent('d2', {
    eventType: 'brand_new_type',
    source: 'nope',
    occurredAt: '2026-09-03T00:00:00Z',
  });
  assert.equal(ev.eventType, 'motion_detected');
  assert.equal(ev.source, 'system');
});

// ── 3. CareEvent -> Firestore write ─────────────────────────────────────
check('newCareEventToFirestore: occurredAt 은 Date, createdAt 없음, fallback 적용', () => {
  const data = newCareEventToFirestore(
    { eventType: 'sos_triggered', source: 'watch' },
    'dev-care-recipient',
  );
  assert.equal(data.careRecipientId, 'dev-care-recipient');
  assert.equal(data.deviceId, null);
  assert.equal(data.eventType, 'sos_triggered');
  assert.ok(data.occurredAt instanceof Date);
  assert.ok(!('createdAt' in data)); // Repository 가 serverTimestamp() 로 붙인다
  assert.ok(!('id' in data));
});

check('round-trip: write data -> 가상 doc -> docToCareEvent 일관', () => {
  const data = newCareEventToFirestore(
    { eventType: 'returned_home', source: 'sensor', occurredAt: '2026-09-03T14:08:00Z' },
    'dev-care-recipient',
  );
  const ev = docToCareEvent('generated_id', {
    ...data,
    occurredAt: { toDate: () => data.occurredAt },
    createdAt: { toDate: () => new Date() },
  });
  assert.equal(ev.id, 'generated_id');
  assert.equal(ev.eventType, 'returned_home');
  assert.equal(ev.occurredAt, '2026-09-03T14:08:00.000Z');
  assert.equal(ev.careRecipientId, 'dev-care-recipient');
});

// ── 4. 파생 뷰 (실시간 스냅샷도 이 함수를 통과) ─────────────────────────
check('deriveEventViews: 최신 우선 정렬 + 오늘 필터 + 마지막 활동', () => {
  const now = new Date('2026-09-03T18:00:00');
  const mk = (id, iso, type = 'motion_detected') => ({
    id, eventType: type, source: 'sensor', occurredAt: iso,
  });
  const views = deriveEventViews(
    [
      mk('a', '2026-09-03T09:00:00'),
      mk('c', '2026-09-02T23:00:00'), // 어제
      mk('b', '2026-09-03T17:00:00'),
      mk('s', '2026-09-03T17:30:00', 'sos_triggered'), // 활동 아님
    ],
    now,
  );
  assert.deepEqual(views.events.map((e) => e.id), ['s', 'b', 'a', 'c']);
  assert.deepEqual(views.todayEvents.map((e) => e.id), ['s', 'b', 'a']);
  assert.equal(views.lastActivity.id, 'b'); // sos 는 활동으로 안 침
});

// ── 5. InMemory 폴백 (Firebase 미설정 시 경로) ──────────────────────────
check('InMemoryEventRepository: append 반환 + 최신 우선 정렬', async () => {
  const repo = new InMemoryEventRepository();
  const saved = await repo.appendEvent({
    id: 'm1', eventType: 'motion_detected', source: 'sensor',
    occurredAt: '2026-09-03T08:00:00.000Z',
  });
  assert.equal(saved.id, 'm1');
  await repo.appendEvent({
    id: 'm2', eventType: 'motion_detected', source: 'sensor',
    occurredAt: '2026-09-03T10:00:00.000Z',
  });
  const list = await repo.listEvents();
  assert.deepEqual(list.map((e) => e.id), ['m2', 'm1']);
  assert.equal(typeof repo.subscribeToEvents, 'undefined'); // 실시간 미지원
});

// ── 6. eventPresenter 기존 동작 유지 (기술 용어 미노출) ─────────────────
check('presentEvent: Firestore 출처 이벤트도 한국어 문장', () => {
  const ev = docToCareEvent('d', {
    eventType: 'motion_detected', source: 'sensor', location: '거실',
    occurredAt: '2026-09-03T07:32:00Z',
  });
  assert.equal(presentEvent(ev).message, '거실에서 활동이 확인됐어요.');
});

// ── run ────────────────────────────────────────────────────────────────
console.log('Phase 2.5 smoke test');
let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
console.log(`\n${passed} checks passed ✅`);
