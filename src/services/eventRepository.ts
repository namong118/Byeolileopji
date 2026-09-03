/**
 * 이벤트 저장소 추상화.
 *
 * 파이프라인의 교체 지점이다:
 *   UI → EventService → EventRepository
 *        (현재) InMemoryEventRepository
 *        (Phase 2) SupabaseEventRepository
 *
 * 다음 Phase 에서는 이 인터페이스의 구현체만 갈아끼우면 된다.
 */

import type { CareEvent } from '../types/events';

export interface EventRepository {
  /** 발생 시각 역순(최신 우선)으로 반환 */
  listEvents(): Promise<CareEvent[]>;
  /**
   * 단일 이벤트를 영속 저장하고, 저장된(정규화된) 이벤트를 돌려준다.
   * Supabase 구현은 DB 가 생성한 실제 id 를 채워 반환한다.
   */
  appendEvent(event: CareEvent): Promise<CareEvent>;
  /**
   * 개발용 목업 데이터 일괄 주입.
   * InMemory 에서만 의미가 있으며, 원격 저장소는 무시한다.
   */
  replaceAll(events: CareEvent[]): Promise<void>;
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
