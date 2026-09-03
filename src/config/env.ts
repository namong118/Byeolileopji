/**
 * 환경변수 접근 지점.
 *
 * Expo 는 `EXPO_PUBLIC_` 접두사가 붙은 변수만 클라이언트 번들에 주입한다.
 * secret(예: service_role key)은 절대 여기서 읽지 않는다.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const env = {
  supabaseUrl: url && url.length > 0 ? url : undefined,
  supabaseAnonKey: anonKey && anonKey.length > 0 ? anonKey : undefined,
  careRecipientIdOverride:
    process.env.EXPO_PUBLIC_CARE_RECIPIENT_ID?.trim() || undefined,
  deviceIdOverride: process.env.EXPO_PUBLIC_DEVICE_ID?.trim() || undefined,
} as const;

/** Supabase URL + anon key 가 모두 있으면 true. */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
