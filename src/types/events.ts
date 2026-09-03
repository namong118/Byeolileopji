/**
 * 공통 생활 이벤트 모델.
 *
 * 향후 Firestore / ESP32-S3 / Wear OS 에서 들어오는 데이터도 모두
 * 이 CareEvent 형태로 정규화되어 같은 파이프라인을 사용한다.
 */

export type EventType =
  | 'motion_detected'
  | 'door_opened'
  | 'left_home'
  | 'returned_home'
  | 'medication_taken'
  | 'medication_missed'
  | 'watch_activity'
  | 'sos_triggered';

export type EventSource = 'sensor' | 'watch' | 'medication' | 'system';

export interface CareEvent {
  id: string;
  eventType: EventType;
  source: EventSource;
  /** 사람이 읽을 수 있는 위치 이름 (예: "거실"). 센서 이벤트에만 존재. */
  location?: string;
  /** ISO 8601 문자열 (UTC). Firestore 는 Timestamp 로 저장한다. */
  occurredAt: string;
  /** 어느 보호대상의 이벤트인지. Phase 2.5: 고정 개발용 ID. */
  careRecipientId?: string;
  /** 어느 디바이스에서 왔는지(센서/워치). 없을 수 있음. */
  deviceId?: string;
  metadata?: Record<string, unknown>;
}

/** 새 이벤트 생성 입력. id / occurredAt 은 서비스가 채운다. */
export type NewCareEvent = Omit<CareEvent, 'id' | 'occurredAt'> &
  Partial<Pick<CareEvent, 'occurredAt'>>;
