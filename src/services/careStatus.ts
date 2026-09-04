/**
 * 상태 판정 규칙 (순수 함수).
 *
 * 입력은 "몇 개의 타임스탬프 + 설정"뿐이다. 이벤트 스캔은 eventViews.ts 가 담당한다.
 * → firebase / react / zustand import 없음 → 단독 실행 테스트 가능
 *   (scripts/phase4-status-smoke.mjs)
 *
 * 판정 우선순위:
 *   1. EMERGENCY  — 최근 sos 이벤트 (lookback 내, TTL 내, 미확인)
 *   2. no_data    — 활동 정보 없음  (내부 status 는 NORMAL 이지만 화면은 중립 문구)
 *   3. CHECK      — inactivity: 마지막 활동 이후 임계 시간 초과
 *   4. NORMAL     — recent_activity
 *
 * systemHealth = **사람 데이터 가용성** (기기 상태 아님):
 *   events 0건 → 'unknown',  그 외 → 'ok'
 *   기기(센서/ESP32) 상태는 별도 축 DeviceHealth (src/services/deviceHealth.ts) 로 분리됨.
 */

import type {
  CareStatus,
  CareStatusResult,
  SystemHealth,
} from '../types/status';
import type { CareStatusConfig } from '../config/careStatusConfig';

export interface DeriveCareStatusInput {
  /** 마지막 "활동" 이벤트 시각 (ISO). eventViews.lastActivity?.occurredAt */
  lastActivityAt?: string;
  /** 마지막 sos_triggered 이벤트 시각 (ISO). eventViews.lastSos?.occurredAt */
  lastSosAt?: string;
  /** 전체 이벤트 수 (0 이면 systemHealth='unknown') */
  totalEventCount: number;
  config: CareStatusConfig;
  now?: Date;
  /**
   * 긴급 확인 시각 (epoch ms 또는 ISO). 이 시각이 sos 시각 이후면 EMERGENCY 해제.
   * Phase 4.0 에서는 개발자 화면의 클라이언트 전용 플래그.
   */
  emergencyAckedAt?: number | string;
}

const HOUR_MS = 3_600_000;

export function deriveCareStatus(
  input: DeriveCareStatusInput,
): CareStatusResult {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const minutesSinceActivity = input.lastActivityAt
    ? Math.floor((nowMs - new Date(input.lastActivityAt).getTime()) / 60_000)
    : undefined;

  const systemHealth: SystemHealth =
    input.totalEventCount === 0 ? 'unknown' : 'ok'; // 사람 데이터 가용성 (기기 아님)

  const base = {
    systemHealth,
    lastActivityAt: input.lastActivityAt,
    minutesSinceActivity,
    computedAt: now.toISOString(),
  };

  // 1) EMERGENCY — 최근 sos
  if (input.lastSosAt) {
    const sosMs = new Date(input.lastSosAt).getTime();
    const ageHours = (nowMs - sosMs) / HOUR_MS;
    const ackMs =
      input.emergencyAckedAt == null
        ? undefined
        : typeof input.emergencyAckedAt === 'number'
          ? input.emergencyAckedAt
          : new Date(input.emergencyAckedAt).getTime();
    const acknowledged = ackMs != null && ackMs >= sosMs;

    if (
      ageHours >= 0 &&
      ageHours < input.config.emergencyLookbackHours &&
      ageHours < input.config.emergencyTtlHours &&
      !acknowledged
    ) {
      return {
        ...base,
        status: 'EMERGENCY',
        reason: 'sos',
        emergencyEventAt: input.lastSosAt,
      };
    }
  }

  // 2) no_data — 활동 정보 없음 (내부 status 는 NORMAL, 화면은 중립)
  if (input.totalEventCount === 0 || minutesSinceActivity == null) {
    return { ...base, status: 'NORMAL', reason: 'no_data' };
  }

  // 3) CHECK — inactivity
  if (minutesSinceActivity >= input.config.inactivityCheckMinutes) {
    return { ...base, status: 'CHECK', reason: 'inactivity' };
  }

  // 4) NORMAL — recent_activity
  return { ...base, status: 'NORMAL', reason: 'recent_activity' };
}

/**
 * 개발자 화면의 임시 오버라이드를 파생 결과 위에 씌운다.
 * TTL 이 지났으면 파생 결과를 그대로 돌려준다. (자동 판정 복귀)
 */
export function applyStatusOverride(
  derived: CareStatusResult,
  override: { status: CareStatus; until: number } | undefined,
  now: Date = new Date(),
): CareStatusResult {
  if (override && override.until > now.getTime()) {
    return { ...derived, status: override.status, reason: 'manual_override' };
  }
  return derived;
}
