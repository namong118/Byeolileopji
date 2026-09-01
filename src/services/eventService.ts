/**
 * 생활 이벤트 도메인 로직.
 *
 * UI 는 저장소를 직접 만지지 않고 항상 이 서비스를 통한다.
 */

import type { CareEvent, NewCareEvent } from '../types/events';
import { isSameDay } from '../utils/time';
import { createId } from '../utils/id';
import {
  InMemoryEventRepository,
  type EventRepository,
} from './eventRepository';

export class EventService {
  private readonly repo: EventRepository;

  constructor(repo: EventRepository) {
    this.repo = repo;
  }

  /** 새 이벤트를 만들어 저장하고, 저장된 CareEvent 를 돌려준다. */
  async recordEvent(input: NewCareEvent): Promise<CareEvent> {
    const event: CareEvent = {
      id: createId(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      eventType: input.eventType,
      source: input.source,
      location: input.location,
      metadata: input.metadata,
    };
    await this.repo.appendEvent(event);
    return event;
  }

  /** 전체 이벤트 (최신 우선) */
  async getEvents(): Promise<CareEvent[]> {
    return this.repo.listEvents();
  }

  /** 오늘 발생한 이벤트만 (최신 우선) */
  async getTodayEvents(now: Date = new Date()): Promise<CareEvent[]> {
    const all = await this.repo.listEvents();
    return all.filter((e) => isSameDay(new Date(e.occurredAt), now));
  }

  /** 가장 최근 "활동성" 이벤트 (홈의 마지막 활동 카드용) */
  async getLastActivity(): Promise<CareEvent | undefined> {
    const all = await this.repo.listEvents();
    return all.find((e) => ACTIVITY_EVENTS.has(e.eventType));
  }

  async seed(events: CareEvent[]): Promise<void> {
    await this.repo.replaceAll(events);
  }
}

/** "마지막 활동"으로 간주할 이벤트 종류 */
const ACTIVITY_EVENTS = new Set<CareEvent['eventType']>([
  'motion_detected',
  'door_opened',
  'returned_home',
  'left_home',
  'watch_activity',
  'medication_taken',
]);

/** 앱 전역에서 공유하는 기본 인스턴스 (Phase 2 에서 repo 만 교체) */
export const eventService = new EventService(new InMemoryEventRepository());
