/**
 * Firestore(Cloud Firestore) 기반 EventRepository 구현.
 *
 *   EventService → EventRepository → FirestoreEventRepository → Firestore
 *
 * 기존 EventRepository 인터페이스를 구현한다. UI/Service/Store 는 바뀌지 않는다.
 * 실시간 구독(subscribeToEvents)은 선택 메서드로 추가 구현한다.
 */

import {
  addDoc,
  collection,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import type { CareEvent } from '../../types/events';
import {
  EventRepositoryError,
  type EventRepository,
  type EventsListener,
  type Unsubscribe,
} from '../eventRepository';
import {
  docToCareEvent,
  newCareEventToFirestore,
  type FirestoreEventData,
} from '../../mappers/firestoreEventMapper';

const EVENTS_COLLECTION = 'events';
const MAX_EVENTS = 500;

export class FirestoreEventRepository implements EventRepository {
  private readonly db: Firestore;
  private readonly careRecipientId: string;

  constructor(db: Firestore, careRecipientId: string) {
    this.db = db;
    this.careRecipientId = careRecipientId;
  }

  /** careRecipientId 고정 + occurredAt desc (복합 인덱스 필요) */
  private buildQuery() {
    return query(
      collection(this.db, EVENTS_COLLECTION),
      where('careRecipientId', '==', this.careRecipientId),
      orderBy('occurredAt', 'desc'),
      fsLimit(MAX_EVENTS),
    );
  }

  private static mapSnap(
    d: QueryDocumentSnapshot,
  ): CareEvent {
    return docToCareEvent(d.id, d.data() as FirestoreEventData);
  }

  async listEvents(): Promise<CareEvent[]> {
    try {
      const snap = await getDocs(this.buildQuery());
      return snap.docs.map(FirestoreEventRepository.mapSnap);
    } catch (error) {
      throw new EventRepositoryError(
        `Firestore 이벤트 조회 실패: ${describe(error)}`,
        error,
      );
    }
  }

  async appendEvent(event: CareEvent): Promise<CareEvent> {
    try {
      const data = newCareEventToFirestore(
        {
          eventType: event.eventType,
          source: event.source,
          location: event.location,
          careRecipientId: event.careRecipientId ?? this.careRecipientId,
          deviceId: event.deviceId,
          metadata: event.metadata,
          occurredAt: event.occurredAt,
        },
        this.careRecipientId,
      );

      const ref = await addDoc(collection(this.db, EVENTS_COLLECTION), {
        ...data,
        createdAt: serverTimestamp(),
      });

      // Firestore 가 부여한 실제 문서 id 를 채워 반환한다.
      return {
        ...event,
        id: ref.id,
        careRecipientId: data.careRecipientId,
        occurredAt: data.occurredAt.toISOString(),
      };
    } catch (error) {
      throw new EventRepositoryError(
        `Firestore 이벤트 저장 실패: ${describe(error)}`,
        error,
      );
    }
  }

  /** 원격 저장소는 목업 일괄 주입을 무시한다(개발 seed 는 Firebase Console/스크립트로). */
  async replaceAll(): Promise<void> {
    if (__DEV__) {
      console.warn(
        '[별일없지] FirestoreEventRepository.replaceAll() 무시됨 — seed 는 Firebase Console 에서 처리합니다.',
      );
    }
  }

  subscribeToEvents(listener: EventsListener): Unsubscribe {
    return onSnapshot(
      this.buildQuery(),
      (snap) => {
        listener(snap.docs.map(FirestoreEventRepository.mapSnap));
      },
      (error) => {
        if (__DEV__) {
          console.error('[별일없지] Firestore 실시간 구독 오류', error);
        }
      },
    );
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
