/**
 * 개발용 보호대상/디바이스 식별자.
 *
 * Phase 2 에는 아직 로그인이 없으므로, 앱은 고정된 개발용 보호대상 1명을 대상으로 동작한다.
 * 이 UUID 들은 `supabase/migrations/*_seed_dev_data.sql` 의 seed row 와 동일해야 한다.
 * (secret 이 아니라 잘 알려진 개발용 고정값이다. env 로 오버라이드 가능.)
 *
 * Phase 4~ 에서 Supabase Auth + guardian_relationships 로 대체된다.
 */

import { env } from './env';

export const DEV_CARE_RECIPIENT_ID =
  env.careRecipientIdOverride ?? '11111111-1111-4111-8111-111111111111';

export const DEV_DEVICE_ID =
  env.deviceIdOverride ?? '22222222-2222-4222-8222-222222222222';
