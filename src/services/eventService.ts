/**
 * 생활 이벤트 도메인 로직.
 *
 * UI 는 저장소를 직접 만지지 않고 항상 이 서비스를 통한다.
 *
 *   UI → careStore → EventService → EventRepository
 *                                    ├─ FirestoreEventRepository  (Firebase config 있을 때)
 *                                    └─ InMemoryEventRepository   (폴백)
 *
 * Phase 5 STEP 5.2 — careRecipientId 는 더 이상 이 파일에 하드코딩되지 않는다.
 * `initCareDataSource()` 가 로그인 후 guardianLinks 로 해석된 careRecipientId 를
 * 주입받아 인스턴스를 만든다 (careStore.init() 이 매 로그인마다 호출한다).
 */

import type { CareEvent, NewCareEvent } from '../types/events';
import { isSameDay } from '../utils/time';
import { createId } from '../utils/id';
import { ACTIVITY_EVENT_TYPES } from './eventViews';
import { isFirebaseConfigured } from '../config/env';
import {
  InMemoryEventRepository,
  type EventRepository,
  type EventsListener,
  type Unsubscribe,
} from './eventRepository';
import { getFirestoreDb } from '../lib/firebase';
import { FirestoreEventRepository } from './firestore/firestoreEventRepository';
import {
  FirestoreDeviceRepository,
  type DeviceRepository,
} from './firestore/deviceRepository';

export class EventService {
  private readonly repo: EventRepository;
  private readonly careRecipientId: string;

  constructor(repo: EventRepository, careRecipientId: string) {
    this.repo = repo;
    this.careRecipientId = careRecipientId;
  }

  /** 새 이벤트를 만들어 저장하고, 저장된(정규화된) CareEvent 를 돌려준다. */
  async recordEvent(input: NewCareEvent): Promise<CareEvent> {
    const draft: CareEvent = {
      id: createId(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      eventType: input.eventType,
      source: input.source,
      location: input.location,
      careRecipientId: input.careRecipientId ?? this.careRecipientId,
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

interface CareDataSource {
  service: EventService;
  deviceRepo?: DeviceRepository;
  dataSource: EventDataSource;
}

function createEventService(
  careRecipientId: string,
  deviceId: string,
): CareDataSource {
  if (isFirebaseConfigured()) {
    const db = getFirestoreDb();
    if (db) {
      return {
        service: new EventService(
          new FirestoreEventRepository(db, careRecipientId),
          careRecipientId,
        ),
        deviceRepo: new FirestoreDeviceRepository(db, deviceId),
        dataSource: 'firebase',
      };
    }
  }
  return {
    service: new EventService(new InMemoryEventRepository(), careRecipientId),
    deviceRepo: undefined,
    dataSource: 'memory',
  };
}

let current: CareDataSource | undefined;

/**
 * 로그인 + guardianLinks 해석이 끝난 뒤 careStore.init() 이 호출한다.
 * 재로그인(다른 계정/관계 변경) 시 다시 호출되어 이전 인스턴스를 완전히 교체한다.
 */
export function initCareDataSource(
  careRecipientId: string,
  deviceId: string,
): void {
  current = createEventService(careRecipientId, deviceId);
}

/** 로그아웃 시 careStore.teardown() 이 호출한다 — 다음 initCareDataSource() 전까지 접근 시 throw. */
export function resetCareDataSource(): void {
  current = undefined;
}

function requireCurrent(): CareDataSource {
  if (!current) {
    throw new Error(
      'eventService: initCareDataSource() 가 아직 호출되지 않았습니다 (로그인/관계 해석 전).',
    );
  }
  return current;
}

/** 앱 전역에서 공유하는 서비스 인스턴스 (로그인 상태에 따라 교체된다). */
export function getEventService(): EventService {
  return requireCurrent().service;
}

/**
 * 기기(devices/{id}) 구독. Firestore 모드에서만 존재한다.
 * undefined 면 기기 축은 항상 'unknown' (문서 없음).
 */
export function getDeviceRepo(): DeviceRepository | undefined {
  return requireCurrent().deviceRepo;
}

/** 현재 어떤 저장소를 쓰는지 (개발자 화면 표시용). */
export function getEventDataSource(): EventDataSource {
  return requireCurrent().dataSource;
}
