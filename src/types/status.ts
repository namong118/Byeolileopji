/**
 * 보호대상의 현재 안심 상태.
 *
 * Phase 1~3 에서는 개발자 화면에서 수동으로만 바꿨다.
 * Phase 4.0 부터 최근 생활 활동 기반으로 자동 판정한다. (src/services/careStatus.ts)
 *
 * 중요:
 *  - `CareStatus` 는 내부 3-상태 모델이다. 화면 문구는 (status, reason) 조합으로 정한다.
 *  - events 가 없거나 아직 판단 불가한 경우 내부 status 는 호환성을 위해 NORMAL 이지만,
 *    화면에는 "오늘도 별일 없어요" 같은 확정 문구를 절대 쓰지 않는다.
 *    (reason='no_data' → 중립 문구)
 */

export type CareStatus = 'NORMAL' | 'CHECK' | 'EMERGENCY';

/** status 를 그렇게 판정한 이유. 화면 문구/톤을 정하는 기준. */
export type CareStatusReason =
  | 'recent_activity' // 최근 활동 확인됨 → "오늘도 별일 없어요"
  | 'inactivity' // 일정 시간 활동 없음 → "한번 확인해 주세요"
  | 'sos' // 명시적 긴급 이벤트 → "도움이 필요할 수 있어요"
  | 'no_data' // 아직 활동 정보 없음 → 중립 문구 (확정 표현 금지)
  | 'sensor_offline' // 센서/ESP32 연결 끊김 (Phase 4.1+ 에서 실제 사용)
  | 'manual_override'; // 개발자 화면에서 임시로 지정한 상태

/**
 * 파이프라인(센서/ESP32/서버) 건강 상태. `CareStatus`(사람)와 직교하는 축.
 * Phase 4.0 에서는 'ok' | 'unknown' 만 실제로 나온다.
 * 'sensor_offline' 은 device heartbeat 가 생기는 Phase 4.1/4.2 에서 활성화된다.
 */
export type SystemHealth = 'ok' | 'unknown' | 'sensor_offline';

/** 순수 판정 함수의 결과. 저장하지 않고 매번 계산한다. */
export interface CareStatusResult {
  status: CareStatus;
  reason: CareStatusReason;
  systemHealth: SystemHealth;
  /** 마지막 활동 이벤트 시각 (ISO). 없으면 undefined. */
  lastActivityAt?: string;
  /** 마지막 활동 이후 경과 분. 없으면 undefined. */
  minutesSinceActivity?: number;
  /** EMERGENCY 를 유발한 sos 이벤트 시각 (ISO). */
  emergencyEventAt?: string;
  /** 이 결과를 계산한 시각 (ISO). "판정 기준 시각" 표시용. */
  computedAt: string;
}
