/**
 * 상태 판정 임계값.
 *
 * ⚠️  아래 기본값은 전부 PoC / 개발용 placeholder 다.
 *     실제 안전 기준(무활동 판정 시간)이 아니다.
 *     실제 값은 수면·외출·센서 위치·생활 패턴 데이터를 확보한 뒤 확정한다.
 *     (Phase 4.1+ 에서 per-보호대상 careConfig 문서 / 시간대 프로파일로 확장 예정)
 *
 * 개발 중에는 아래 EXPO_PUBLIC_* 환경변수로 조정한다. 예:
 *     EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2
 *     EXPO_PUBLIC_EMERGENCY_TTL_HOURS=0.05
 * (환경변수 변경 후에는 `npm start -c` 로 캐시를 비우고 재시작한다)
 */

function num(name: string, fallback: number): number {
  // env.ts 와 동일한 동적 접근 패턴 (Expo 런타임의 process.env EXPO_PUBLIC_* 지원에 의존)
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface CareStatusConfig {
  /** 이 시간(분) 이상 활동이 없으면 CHECK */
  inactivityCheckMinutes: number;
  /** sos 이벤트를 "최근"으로 볼 시간(시간) */
  emergencyLookbackHours: number;
  /** sos 이벤트가 이 시간(시간)을 넘으면 EMERGENCY 자동 만료 (미확인이어도) */
  emergencyTtlHours: number;
  /** 앱이 켜져 있을 때 상태를 재계산하는 주기(ms). Firestore 접근 없음. */
  recomputeIntervalMs: number;
  /** 개발자 화면 임시 오버라이드의 유효 시간(ms) */
  overrideTtlMs: number;
  /**
   * heartbeat 가 이 시간(분) 이내면 기기 online, 초과면 offline.
   * ⚠️ Phase 4.1a 에는 heartbeat 가 없어 실제로는 unknown 만 나온다. (Phase 4.1b 에서 활성)
   */
  deviceOfflineMinutes: number;
}

/** ⚠️ PoC placeholder — 실제 안전 기준 아님 */
export const careStatusConfig: CareStatusConfig = {
  inactivityCheckMinutes: num('EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES', 180),
  emergencyLookbackHours: num('EXPO_PUBLIC_EMERGENCY_LOOKBACK_HOURS', 12),
  emergencyTtlHours: num('EXPO_PUBLIC_EMERGENCY_TTL_HOURS', 12),
  recomputeIntervalMs: num('EXPO_PUBLIC_STATUS_RECOMPUTE_INTERVAL_MS', 30_000),
  overrideTtlMs: num('EXPO_PUBLIC_STATUS_OVERRIDE_TTL_MS', 600_000),
  deviceOfflineMinutes: num('EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES', 25),
};
