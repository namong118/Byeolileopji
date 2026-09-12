/**
 * Developer Simulation 전용 EventService — Phase 5 STEP 5.3-C.
 *
 *   Developer 탭 "이벤트 발생" 버튼 → simulationEventService → InMemoryEventRepository
 *
 * production careStore / guardianLinks 로 resolve 된 careRecipientId / 실제
 * Firestore EventService(eventService.ts 의 getEventService())와 **완전히 분리**된
 * 별도 인스턴스다. 항상 InMemoryEventRepository 만 쓰므로 어떤 버튼을 눌러도
 * 실제 Firestore `events` 컬렉션에는 절대 write 되지 않는다.
 *
 * 로그인 상태/guardian 관계 해석 여부와 무관하게 항상 존재한다(모듈 로드 시
 * 1회 생성되는 싱글턴) — Auth/guardianLinks/push registration 어느 것에도 의존하지 않는다.
 */

import { EventService } from './eventService';
import { InMemoryEventRepository } from './eventRepository';

/** 표시용 식별자일 뿐 — InMemory 라 Firestore 문서 id 로 쓰이지 않는다. */
const SIMULATION_CARE_RECIPIENT_ID = 'simulation-only';

export const simulationEventService = new EventService(
  new InMemoryEventRepository(),
  SIMULATION_CARE_RECIPIENT_ID,
);
