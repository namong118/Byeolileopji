/**
 * Supabase 클라이언트 싱글턴.
 *
 * - anon key 만 사용한다. (service_role key 는 클라이언트에 절대 포함하지 않는다)
 * - Phase 2 에는 로그인이 없으므로 세션 관련 기능을 모두 끈다.
 * - Realtime 은 사용하지 않는다. (Phase 3 에서 ESP32 외부 이벤트 수신 시 추가)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env, isSupabaseConfigured } from '../../config/env';

let cached: SupabaseClient | null = null;

/**
 * 설정돼 있으면 Supabase 클라이언트를, 아니면 null 을 반환한다.
 * 호출부는 null 인 경우 InMemory 로 폴백해야 한다.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (cached) return cached;

  cached = createClient(env.supabaseUrl as string, env.supabaseAnonKey as string, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}
