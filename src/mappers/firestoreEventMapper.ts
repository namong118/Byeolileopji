/**
 * Firestore document <-> CareEvent 도메인 모델 변환.
 *
 * UI 는 절대 Firestore 문서 형태를 직접 다루지 않는다. 여기서만 변환한다.
 *
 * 이 파일은 firebase 런타임 import 가 없다(타입/순수 함수만).
 * → Node 로 단독 실행 테스트가 가능하다. Firestore Timestamp 는 "구조"로만 다룬다.
 */

import type {
  CareEvent,
  EventSource,
  EventType,
  NewCareEvent,
} from '../types/events';

const EVENT_TYPES: readonly EventType[] = [
  'motion_detected',
  'door_opened',
  'left_home',
  'returned_home',
  'medication_taken',
  'medication_missed',
  'watch_activity',
  'sos_triggered',
];

const EVENT_SOURCES: readonly EventSource[] = [
  'sensor',
  'watch',
  'medication',
  'system',
];

/** Firestore Timestamp | Date | ISO string | {seconds} 등 어떤 형태든 ISO(UTC) 문자열로. */
export function toIsoString(value: unknown): string {
  if (value == null) return new Date().toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const obj = value as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') return obj.toDate().toISOString();
    if (typeof obj.seconds === 'number') {
      return new Date(obj.seconds * 1000).toISOString();
    }
  }
  return new Date().toISOString();
}

function coerceEventType(value: unknown): EventType {
  return typeof value === 'string' &&
    (EVENT_TYPES as readonly string[]).includes(value)
    ? (value as EventType)
    : 'motion_detected';
}

function coerceSource(value: unknown): EventSource {
  return typeof value === 'string' &&
    (EVENT_SOURCES as readonly string[]).includes(value)
    ? (value as EventSource)
    : 'system';
}

export interface FirestoreEventData {
  careRecipientId?: unknown;
  deviceId?: unknown;
  eventType?: unknown;
  source?: unknown;
  location?: unknown;
  payload?: unknown;
  occurredAt?: unknown;
  createdAt?: unknown;
}

/** Firestore 문서(id + data) -> 도메인 CareEvent */
export function docToCareEvent(
  id: string,
  data: FirestoreEventData,
): CareEvent {
  const payload =
    data.payload && typeof data.payload === 'object'
      ? (data.payload as Record<string, unknown>)
      : {};
  const hasPayload = Object.keys(payload).length > 0;

  return {
    id,
    eventType: coerceEventType(data.eventType),
    source: coerceSource(data.source),
    location:
      typeof data.location === 'string' && data.location.length > 0
        ? data.location
        : undefined,
    occurredAt: toIsoString(data.occurredAt),
    careRecipientId:
      typeof data.careRecipientId === 'string'
        ? data.careRecipientId
        : undefined,
    deviceId: typeof data.deviceId === 'string' ? data.deviceId : undefined,
    metadata: hasPayload ? payload : undefined,
  };
}

/**
 * 새 이벤트 -> Firestore write 데이터.
 * - `occurredAt` 은 JS Date 로 둔다 (Firestore SDK 가 Timestamp 로 저장).
 * - `createdAt` 은 여기서 만들지 않는다. Repository 가 serverTimestamp() 를 붙인다.
 */
export function newCareEventToFirestore(
  input: NewCareEvent,
  fallbackCareRecipientId: string,
): {
  careRecipientId: string;
  deviceId: string | null;
  eventType: EventType;
  source: EventSource;
  location: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
} {
  return {
    careRecipientId: input.careRecipientId ?? fallbackCareRecipientId,
    deviceId: input.deviceId ?? null,
    eventType: input.eventType,
    source: input.source,
    location: input.location ?? null,
    payload: input.metadata ?? {},
    occurredAt: new Date(input.occurredAt ?? Date.now()),
  };
}
