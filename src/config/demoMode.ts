/**
 * XIAO 자세 인식 웹 데모 모드.
 *
 * Platform.OS === 'web' 이고 EXPO_PUBLIC_DEMO_RECIPIENT_ID 가 있을 때만 켜진다.
 * 모바일(iOS/Android) 빌드는 환경변수가 있어도 항상 꺼져 있다 — 기존 동작 그대로.
 *
 * 데모 모드에서:
 *   - guardianStore 가 데모 보호대상 연결(guardianLinks/{uid}_{demoId})을 고른다.
 *   - 홈 상태 영역은 데모 카드로 대체한다 (Cron 이 데모 대상을 판정하지 않아 서버 상태가 없다).
 *   - 폭 1024px 이상이면 폰 프레임 + 실시간 이벤트 로그 패널(DemoWebShell).
 *   - push token 등록을 하지 않는다.
 */

import { Platform } from 'react-native';

import { env } from './env';
import { DEFAULT_LYING_ALERT_SECONDS } from '../utils/posture';

export const DEMO_RECIPIENT_ID: string | undefined =
  Platform.OS === 'web' ? env.demoRecipientId : undefined;

export const isDemoMode = Boolean(DEMO_RECIPIENT_ID);

/** 데모 모드에서 careStore 가 구독하는 기기 문서 (scripts/register-xiao-demo-devices.mjs) */
export const DEMO_DEVICE_ID = 'xiao-living';

function parseSeconds(raw: string | undefined): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LYING_ALERT_SECONDS;
}

export const DEMO_LYING_ALERT_MS = parseSeconds(env.demoLyingAlertSeconds) * 1000;
