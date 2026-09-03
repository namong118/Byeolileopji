/**
 * 이벤트 저장소 추상화.
 *
 * 파이프라인의 교체 지점이다:
 *   UI → EventService → EventRepository
 *        ├─ FirestoreEventRepository  (Firebase config 있을 때)
 *        └─ InMemoryEventRepository   (폴백)
 *
 * 다음 Phase 에서도 이 인터페이스의 구현체만 갈아끼우면 된다.
 */

import type { CareEvent } from '../types/events';

/** 실시간 구독 해제 함수 */
export type Unsubscribe = () => void;

/** 실시간 이벤트 리스너. 항상 "최신 우선" 전체 목록을 전달한다. */
export type EventsListener = (events: CareEvent[]) => void;

export interface EventRepository {
  /** 발생 시각 역순(최신 우선)으로 반환 */
  listEvents(): Promise<CareEvent[]>;
  /**
   * 단일 이벤트를 영속 저장하고, 저장된(정규화된) 이벤트를 돌려준다.
   * 원격 구현은 서버가 생성한 실제 id 를 채워 반환한다.
   */
  appendEvent(event: CareEvent): Promise<CareEvent>;
  /**
   * 개발용 목업 데이터 일괄 주입.
   * InMemory 에서만 의미가 있으며, 원격 저장소는 무시한다.
   */
  replaceAll(events: CareEvent[]): Promise<void>;
  /**
   * (선택) 실시간 구독. 지원하는 저장소만 구현한다.
   * 구독 즉시 현재 스냅샷으로 한 번 호출되고, 이후 변경마다 호출된다.
   * 반환된 함수로 구독을 해제한다.
   */
  subscribeToEvents?(listener: EventsListener): Unsubscribe;
}

/** 저장소 계층에서 발생한 오류. 사용자용 메시지는 UI 레이어에서 만든다. */
export class EventRepositoryError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EventRepositoryError';
    this.cause = cause;
  }
}

export class InMemoryEventRepository implements EventRepository {
  private events: CareEvent[] = [];

  async listEvents(): Promise<CareEvent[]> {
    return [...this.events].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }

  async appendEvent(event: CareEvent): Promise<CareEvent> {
    this.events.push(event);
    return event;
  }

  async replaceAll(events: CareEvent[]): Promise<void> {
    this.events = [...events];
  }
}
