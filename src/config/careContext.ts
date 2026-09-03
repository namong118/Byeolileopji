/**
 * 개발용 보호대상/디바이스 식별자. (하드코딩 값은 이 파일 한 곳에서만 관리한다)
 *
 * Phase 2.5 에는 아직 로그인이 없으므로, 앱은 고정된 개발용 보호대상 1명을 대상으로 동작한다.
 * 이 값들은 Firestore 의 `careRecipients/{id}` · `devices/{id}` 문서 ID 와 동일하게 쓴다.
 * (secret 이 아니라 잘 알려진 개발용 고정값이다. env 로 오버라이드 가능.)
 *
 * Phase 4~ 에서 Firebase Auth + guardian 관계 모델로 대체된다.
 */

import { env } from './env';

export const DEV_CARE_RECIPIENT_ID =
  env.careRecipientIdOverride ?? 'dev-care-recipient';

export const DEV_DEVICE_ID = env.deviceIdOverride ?? 'dev-device-livingroom';
