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
  /** 단일 이벤트 추가 */
  appendEvent(event: CareEvent): Promise<void>;
  /** 초기 목업 데이터 주입 (앱 시작 시 1회) */
  replaceAll(events: CareEvent[]): Promise<void>;
}

export class InMemoryEventRepository implements EventRepository {
  private events: CareEvent[] = [];

  async listEvents(): Promise<CareEvent[]> {
    return [...this.events].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }

  async appendEvent(event: CareEvent): Promise<void> {
    this.events.push(event);
  }

  async replaceAll(events: CareEvent[]): Promise<void> {
    this.events = [...events];
  }
}
