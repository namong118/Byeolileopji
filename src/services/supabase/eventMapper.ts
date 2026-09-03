/**
 * Supabase row <-> CareEvent 도메인 모델 변환.
 *
 * UI 는 절대 DB row 형태(snake_case)를 직접 다루지 않는다.
 * 여기서만 변환하면 향후 DB 컬럼 변경이 UI 전체로 퍼지지 않는다.
 *
 * 이 파일은 런타임 import 가 없다(타입만). 그래서 단독 실행 테스트가 쉽다.
 */

import type { CareEvent, EventSource, EventType, NewCareEvent } from '../../types/events';
import type { EventInsert, EventRow } from './database.types';

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

function coerceEventType(value: string): EventType {
  return (EVENT_TYPES as readonly string[]).includes(value)
    ? (value as EventType)
    : 'motion_detected';
}

function coerceSource(value: string): EventSource {
  return (EVENT_SOURCES as readonly string[]).includes(value)
    ? (value as EventSource)
    : 'system';
}

/** DB row -> 도메인 CareEvent */
export function rowToCareEvent(row: EventRow): CareEvent {
  const payload =
    row.payload && typeof row.payload === 'object' ? row.payload : {};
  const hasPayload = Object.keys(payload).length > 0;

  return {
    id: row.id,
    eventType: coerceEventType(row.event_type),
    source: coerceSource(row.source),
    location: row.location ?? undefined,
    occurredAt: new Date(row.occurred_at).toISOString(),
    careRecipientId: row.care_recipient_id,
    deviceId: row.device_id ?? undefined,
    metadata: hasPayload ? payload : undefined,
  };
}

/**
 * 새 이벤트 -> DB INSERT payload.
 * id / created_at 은 DB 기본값(gen_random_uuid(), now())에 맡긴다.
 */
export function newCareEventToInsert(
  input: NewCareEvent,
  fallbackCareRecipientId: string,
): EventInsert {
  return {
    care_recipient_id: input.careRecipientId ?? fallbackCareRecipientId,
    device_id: input.deviceId ?? null,
    event_type: input.eventType,
    source: input.source,
    location: input.location ?? null,
    payload: input.metadata ?? {},
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  };
}

/** 이미 만들어진 CareEvent -> DB INSERT payload (InMemory 경로와의 대칭용) */
export function careEventToInsert(event: CareEvent): EventInsert {
  return {
    care_recipient_id: event.careRecipientId ?? '',
    device_id: event.deviceId ?? null,
    event_type: event.eventType,
    source: event.source,
    location: event.location ?? null,
    payload: event.metadata ?? {},
    occurred_at: event.occurredAt,
  };
}
