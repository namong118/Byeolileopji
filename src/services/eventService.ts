/**
 * 생활 이벤트 도메인 로직.
 *
 * UI 는 저장소를 직접 만지지 않고 항상 이 서비스를 통한다.
 *
 *   UI → careStore → EventService → EventRepository
 *                                    ├─ FirestoreEventRepository  (Firebase config 있을 때)
 *                                    └─ InMemoryEventRepository   (폴백)
 */

import type { CareEvent, NewCareEvent } from '../types/events';
import { isSameDay } from '../utils/time';
import { createId } from '../utils/id';
import { ACTIVITY_EVENT_TYPES } from './eventViews';
import { DEV_CARE_RECIPIENT_ID } from '../config/careContext';
import { isFirebaseConfigured } from '../config/env';
import {
  InMemoryEventRepository,
  type EventRepository,
  type EventsListener,
  type Unsubscribe,
} from './eventRepository';
import { getFirestoreDb } from '../lib/firebase';
import { FirestoreEventRepository } from './firestore/firestoreEventRepository';

export class EventService {
  private readonly repo: EventRepository;

  constructor(repo: EventRepository) {
    this.repo = repo;
  }

  /** 새 이벤트를 만들어 저장하고, 저장된(정규화된) CareEvent 를 돌려준다. */
  async recordEvent(input: NewCareEvent): Promise<CareEvent> {
    const draft: CareEvent = {
      id: createId(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      eventType: input.eventType,
      source: input.source,
      location: input.location,
      careRecipientId: input.careRecipientId ?? DEV_CARE_RECIPIENT_ID,
      deviceId: input.deviceId,
      metadata: input.metadata,
    };
    return this.repo.appendEvent(draft);
  }

  /** 전체 이벤트 (최신 우선) */
  async getEvents(): Promise<CareEvent[]> {
    return this.repo.listEvents();
  }

  /** 오늘(로컬 타임존 기준) 발생한 이벤트만 (최신 우선) */
  async getTodayEvents(now: Date = new Date()): Promise<CareEvent[]> {
    const all = await this.repo.listEvents();
    return all.filter((e) => isSameDay(new Date(e.occurredAt), now));
  }

  /** 가장 최근 "활동성" 이벤트 (홈의 마지막 활동 카드용) */
  async getLastActivity(): Promise<CareEvent | undefined> {
    const all = await this.repo.listEvents();
    return all.find((e) => ACTIVITY_EVENT_TYPES.has(e.eventType));
  }

  /** 개발용 목업 seed (InMemory 에서만 효과 있음) */
  async seed(events: CareEvent[]): Promise<void> {
    await this.repo.replaceAll(events);
  }

  /** 저장소가 실시간 구독을 지원하는지 */
  supportsRealtime(): boolean {
    return typeof this.repo.subscribeToEvents === 'function';
  }

  /**
   * 실시간 구독. 지원하지 않으면 undefined.
   * listener 는 항상 "최신 우선 전체 목록" 을 받는다.
   */
  subscribeToEvents(listener: EventsListener): Unsubscribe | undefined {
    return this.repo.subscribeToEvents?.(listener);
  }
}

/** 파생 뷰 로직은 `eventViews.ts` (순수) 에서 재노출한다. */
export { deriveEventViews, type EventViews } from './eventViews';

export type EventDataSource = 'firebase' | 'memory';

function createEventService(): {
  service: EventService;
  dataSource: EventDataSource;
} {
  if (isFirebaseConfigured()) {
    const db = getFirestoreDb();
    if (db) {
      return {
        service: new EventService(
          new FirestoreEventRepository(db, DEV_CARE_RECIPIENT_ID),
        ),
        dataSource: 'firebase',
      };
    }
  }
  return {
    service: new EventService(new InMemoryEventRepository()),
    dataSource: 'memory',
  };
}

const created = createEventService();

/** 앱 전역에서 공유하는 서비스 인스턴스. */
export const eventService = created.service;

/** 현재 어떤 저장소를 쓰는지 (개발자 화면 표시용). */
export const EVENT_DATA_SOURCE: EventDataSource = created.dataSource;
