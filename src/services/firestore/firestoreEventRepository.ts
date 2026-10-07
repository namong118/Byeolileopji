/**
 * Firestore(Cloud Firestore) 기반 EventRepository 구현.
 *
 *   EventService → EventRepository → FirestoreEventRepository → Firestore
 *
 * 기존 EventRepository 인터페이스를 구현한다. UI/Service/Store 는 바뀌지 않는다.
 * 실시간 구독(subscribeToEvents)은 선택 메서드로 추가 구현한다.
 *
 * 조회는 셋으로 나뉘고 합집합을 돌려준다 (이유·규칙은 src/services/eventWindow.ts):
 *   recent  : careRecipientId == X, occurredAt desc, limit RECENT_EVENTS_LIMIT
 *   today   : careRecipientId == X, occurredAt >= 오늘 00:00(로컬), occurredAt desc,
 *             limit TODAY_EVENTS_SAFETY_CAP + 1      ← 기존 인덱스 (careRecipientId, occurredAt desc)
 *   sos     : careRecipientId == X, eventType == 'sos_triggered', occurredAt desc, limit 1
 *             ← 복합 인덱스 (careRecipientId, eventType, occurredAt desc) 필요
 * 세 쿼리 모두 careRecipientId 등호 필터를 가지므로 Rules(events read = isGuardianOf) 를 통과한다.
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
  Timestamp,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';

import type { CareEvent } from '../../types/events';
import {
  EventRepositoryError,
  type EventRepository,
  type EventsListener,
  type EventsMeta,
  type Unsubscribe,
} from '../eventRepository';
import {
  combineEventWindows,
  createEventWindowSubscription,
  RECENT_EVENTS_LIMIT,
  startOfLocalDay,
  TODAY_EVENTS_SAFETY_CAP,
  type EventWindowSource,
  type EventWindowSubscription,
} from '../eventWindow';
import {
  docToCareEvent,
  newCareEventToFirestore,
  type FirestoreEventData,
} from '../../mappers/firestoreEventMapper';

const EVENTS_COLLECTION = 'events';
/** 구독 중 "오늘" 경계(로컬 자정)가 바뀌었는지 확인하는 주기. 긴 setTimeout 대신 짧은 interval. */
const DAY_ROLLOVER_CHECK_MS = 60_000;

export class FirestoreEventRepository implements EventRepository {
  private readonly db: Firestore;
  private readonly careRecipientId: string;

  constructor(db: Firestore, careRecipientId: string) {
    this.db = db;
    this.careRecipientId = careRecipientId;
  }

  private eventsRef() {
    return collection(this.db, EVENTS_COLLECTION);
  }

  /** recent — careRecipientId 고정 + occurredAt desc (복합 인덱스 필요) */
  private buildRecentQuery() {
    return query(
      this.eventsRef(),
      where('careRecipientId', '==', this.careRecipientId),
      orderBy('occurredAt', 'desc'),
      fsLimit(RECENT_EVENTS_LIMIT),
    );
  }

  /** today — occurredAt 은 Firestore Timestamp 로 저장되므로 Timestamp 로 비교한다. */
  private buildTodayQuery(dayStart: Date) {
    return query(
      this.eventsRef(),
      where('careRecipientId', '==', this.careRecipientId),
      where('occurredAt', '>=', Timestamp.fromDate(dayStart)),
      orderBy('occurredAt', 'desc'),
      fsLimit(TODAY_EVENTS_SAFETY_CAP + 1), // +1 = 상한 초과 감지용
    );
  }

  /** sos — 최신 sos_triggered 1건 (복합 인덱스 careRecipientId + eventType + occurredAt desc) */
  private buildLatestSosQuery() {
    return query(
      this.eventsRef(),
      where('careRecipientId', '==', this.careRecipientId),
      where('eventType', '==', 'sos_triggered'),
      orderBy('occurredAt', 'desc'),
      fsLimit(1),
    );
  }

  private static mapSnap(
    d: QueryDocumentSnapshot,
  ): CareEvent {
    return docToCareEvent(d.id, d.data() as FirestoreEventData);
  }

  private static mapAll(snap: QuerySnapshot): CareEvent[] {
    return snap.docs.map(FirestoreEventRepository.mapSnap);
  }

  async listEvents(): Promise<CareEvent[]> {
    return (await this.listEventsWithMeta()).events;
  }

  async listEventsWithMeta(): Promise<{ events: CareEvent[]; meta: EventsMeta }> {
    try {
      // 셋 중 하나라도 실패하면 전체 실패 — SOS 나 오늘 이벤트를 조용히 빠뜨리지 않는다.
      const [recent, today, latestSos] = await Promise.all([
        getDocs(this.buildRecentQuery()),
        getDocs(this.buildTodayQuery(startOfLocalDay(new Date()))),
        getDocs(this.buildLatestSosQuery()),
      ]);
      const r = combineEventWindows({
        recent: FirestoreEventRepository.mapAll(recent),
        today: FirestoreEventRepository.mapAll(today),
        latestSos: FirestoreEventRepository.mapAll(latestSos),
      });
      return {
        events: r.events,
        meta: {
          todayTruncated: r.todayTruncated,
          // getDocs 는 오프라인이면 캐시로 응답할 수 있다 — 서버 확인 여부를 그대로 전달한다.
          fromCache:
            recent.metadata.fromCache || today.metadata.fromCache || latestSos.metadata.fromCache,
        },
      };
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

  /** 현재 열린 구독들 — refreshDayWindow() 가 날짜 변경을 즉시 반영할 대상 */
  private readonly activeSubscriptions = new Set<EventWindowSubscription>();

  private source(q: Query, label: string): EventWindowSource {
    return (onNext, onError) =>
      onSnapshot(
        q,
        // 네트워크 끊김은 error 가 아니라 fromCache=true 메타데이터 변경으로만 온다.
        // includeMetadataChanges 없이는 그 변경이 전달되지 않는다 (syncState.ts).
        { includeMetadataChanges: true },
        (snap) => onNext(FirestoreEventRepository.mapAll(snap), { fromCache: snap.metadata.fromCache }),
        (error) => {
          if (__DEV__) {
            console.error(`[별일없지] Firestore 실시간 구독 오류 (${label})`, error);
          }
          onError(error);
        },
      );
  }

  /**
   * 세 쿼리를 각각 onSnapshot 으로 구독하고, 합집합을 listener 에 전달한다.
   * 조정 규칙(첫 스냅샷 대기 / 오류 시 실패 고정 / 날짜 전환)은
   * eventWindow.createEventWindowSubscription — Node 스모크로 검증된다.
   *
   * - 어느 구독이든 오류가 나면 onError 가 한 번 호출되고 이후 listener 는 호출되지 않는다.
   *   (마지막 상태로 조용히 멈추지 않는다 — careStore 가 eventsSync.failed → syncNotice 로 화면에 드러낸다.)
   * - 로컬 날짜 변경은 DAY_ROLLOVER_CHECK_MS 주기 + refreshDayWindow()(AppState active)로 반영한다.
   */
  subscribeToEvents(
    listener: EventsListener,
    onError?: (error: unknown) => void,
  ): Unsubscribe {
    const sub = createEventWindowSubscription({
      recent: this.source(this.buildRecentQuery(), 'recent'),
      today: (dayStart) => this.source(this.buildTodayQuery(dayStart), 'today'),
      latestSos: this.source(this.buildLatestSosQuery(), 'sos'),
      listener,
      onError: (error) => onError?.(error),
    });
    this.activeSubscriptions.add(sub);
    const rolloverTimer = setInterval(() => sub.checkDayRollover(), DAY_ROLLOVER_CHECK_MS);

    return () => {
      clearInterval(rolloverTimer);
      this.activeSubscriptions.delete(sub);
      sub.unsubscribe();
    };
  }

  /** 로컬 날짜가 바뀌었으면 열린 구독의 today 창을 즉시 새 자정 기준으로 옮긴다. */
  refreshDayWindow(): void {
    for (const sub of this.activeSubscriptions) sub.checkDayRollover();
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
