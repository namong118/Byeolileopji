/**
 * Supabase(PostgreSQL) 기반 EventRepository 구현.
 *
 *   EventService → EventRepository → SupabaseEventRepository → Supabase
 *
 * 기존 EventRepository 인터페이스를 그대로 구현한다. UI/Service 는 바뀌지 않는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CareEvent } from '../../types/events';
import {
  EventRepositoryError,
  type EventRepository,
} from '../eventRepository';
import type { EventRow } from './database.types';
import { careEventToInsert, rowToCareEvent } from './eventMapper';

const EVENTS_TABLE = 'events';
const MAX_EVENTS = 500;

export class SupabaseEventRepository implements EventRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async listEvents(): Promise<CareEvent[]> {
    const { data, error } = await this.client
      .from(EVENTS_TABLE)
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(MAX_EVENTS);

    if (error) {
      throw new EventRepositoryError(
        `이벤트 조회 실패: ${error.message}`,
        error,
      );
    }

    return (data as EventRow[]).map(rowToCareEvent);
  }

  async appendEvent(event: CareEvent): Promise<CareEvent> {
    const insert = careEventToInsert(event);

    const { data, error } = await this.client
      .from(EVENTS_TABLE)
      .insert(insert)
      .select('*')
      .single();

    if (error) {
      throw new EventRepositoryError(
        `이벤트 저장 실패: ${error.message}`,
        error,
      );
    }

    return rowToCareEvent(data as EventRow);
  }

  /** 원격 저장소는 목업 일괄 주입을 무시한다(개발 seed 는 SQL migration 으로 처리). */
  async replaceAll(): Promise<void> {
    if (__DEV__) {
      console.warn(
        '[별일없지] SupabaseEventRepository.replaceAll() 무시됨 — seed 는 supabase/migrations 에서 처리합니다.',
      );
    }
  }
}
