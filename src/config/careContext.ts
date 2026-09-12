/**
 * 개발용 보호대상/디바이스 식별자. (하드코딩 값은 이 파일 한 곳에서만 관리한다)
 *
 * Phase 5 STEP 5.2 부터 Firebase 모드(Firestore 설정됨)에서는 careRecipientId 를 더 이상
 * 여기서 읽지 않는다 — 로그인 UID → guardianLinks 조회로 해석한다(guardianStore.ts).
 * `DEV_CARE_RECIPIENT_ID` 는 (1) InMemory 개발 모드(Firestore 미설정, guardianStore 가
 * fallback) 와 (2) InMemory 전용 mock/seed 데이터에서만 쓰인다.
 *
 * `DEV_DEVICE_ID` 는 이번 STEP 에서도 그대로 쓴다 — device 는 guardian 관계로 해석하지
 * 않는다(devices/{id} 문서가 이미 careRecipientId 필드를 가지고 있어 Phase 5.3 Rules 가
 * 그 필드로 권한을 검증할 수 있다).
 *
 * 이 값들은 Firestore 의 `careRecipients/{id}` · `devices/{id}` 문서 ID 와 동일하게 쓴다.
 * (secret 이 아니라 잘 알려진 개발용 고정값이다. env 로 오버라이드 가능.)
 */

import { env } from './env';

export const DEV_CARE_RECIPIENT_ID =
  env.careRecipientIdOverride ?? 'dev-care-recipient';

export const DEV_DEVICE_ID = env.deviceIdOverride ?? 'dev-device-livingroom';
