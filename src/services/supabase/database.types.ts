/**
 * Supabase 테이블의 최소 타입 정의 (수기 작성).
 *
 * 스키마가 커지면 `supabase gen types typescript` 로 대체할 수 있다.
 * 지금은 events 파이프라인에 필요한 부분만 정의한다.
 */

export interface EventRow {
  id: string;
  care_recipient_id: string;
  device_id: string | null;
  event_type: string;
  source: string;
  location: string | null;
  payload: Record<string, unknown>;
  occurred_at: string; // timestamptz -> ISO 8601 (UTC)
  created_at: string;
}

/** INSERT 시 보낼 형태. id / created_at 은 DB 기본값에 맡긴다. */
export interface EventInsert {
  care_recipient_id: string;
  device_id?: string | null;
  event_type: string;
  source: string;
  location?: string | null;
  payload?: Record<string, unknown>;
  occurred_at: string;
}

export interface CareRecipientRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DeviceRow {
  id: string;
  care_recipient_id: string;
  device_type: string;
  name: string;
  location: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
