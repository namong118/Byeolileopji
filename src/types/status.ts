/**
 * 보호대상의 현재 안심 상태 — **사람 축**.
 *
 * Phase 4.0 부터 최근 생활 활동 기반으로 자동 판정한다. (src/services/careStatus.ts)
 * Phase 4.1a 부터 **기기 축(DeviceHealth)** 을 완전히 별개의 축으로 분리한다.
 *   - 사람 축:  NORMAL / CHECK / EMERGENCY   (deriveCareStatus)
 *   - 기기 축:  online / offline / unknown   (deriveDeviceHealth)
 *   - 두 enum 을 절대 합치지 않는다. 표시 경계(presentHome)에서만 조합한다.
 *
 * 중요:
 *  - events 가 없거나 판단 불가한 경우 내부 status 는 호환성을 위해 NORMAL 이지만,
 *    화면에는 "오늘도 별일 없어요" 같은 확정 문구를 절대 쓰지 않는다. (reason='no_data')
 *  - deviceHealth === 'offline' 이면 (EMERGENCY 아닌 한) Hero 는 중립 문구를 쓴다.
 */

// ── 사람 축 ────────────────────────────────────────────────────────────

export type CareStatus = 'NORMAL' | 'CHECK' | 'EMERGENCY';

/** status 를 그렇게 판정한 이유. 화면 문구/톤을 정하는 기준. */
export type CareStatusReason =
  | 'recent_activity' // 최근 활동 확인됨 → "오늘도 별일 없어요"
  | 'inactivity' // 일정 시간 활동 없음 → "한번 확인해 주세요"
  | 'sos' // 명시적 긴급 이벤트 → "도움이 필요할 수 있어요"
  | 'no_data' // 아직 활동 정보 없음 → 중립 문구 (확정 표현 금지)
  | 'manual_override'; // 개발자 화면에서 임시로 지정한 상태

/**
 * **사람 데이터 가용성** (기기 상태 아님 — 기기는 DeviceHealth).
 * events 0건 → 'unknown', 그 외 → 'ok'.
 */
export type SystemHealth = 'ok' | 'unknown';

/** 순수 사람-축 판정 함수의 결과. 저장하지 않고 매번 계산한다. */
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

// ── 기기 축 (Phase 4.1a) ──────────────────────────────────────────────

export type DeviceHealth = 'online' | 'offline' | 'unknown';

export type DeviceHealthReason =
  | 'heartbeat_fresh' // lastHeartbeatAt 이 임계 이내 → online
  | 'heartbeat_stale' // lastHeartbeatAt 이 임계 초과 → offline
  | 'no_heartbeat_capability' // heartbeat 신호가 아직 없음 (Phase 4.1a 는 항상 이 상태) → unknown
  | 'no_device_doc'; // devices/{id} 문서 없음 → unknown

/**
 * 순수 기기-축 판정 함수의 결과.
 *
 * ⚠️ Phase 4.1a: 실제 heartbeat 가 없으므로 lastEventAt 이 아무리 오래돼도
 *    offline 을 주장하지 않는다. heartbeat 신호(lastHeartbeatAt)가 없으면 반드시 unknown.
 *    online/offline 은 synthetic/unit test 에서만 나온다.
 */
export interface DeviceHealthResult {
  health: DeviceHealth;
  reason: DeviceHealthReason;
  /** 마지막 이벤트가 서버에 도착한 시각 (ISO). Worker 가 ingest 시 갱신. */
  lastEventAt?: string;
  /** ESP32 가 살아있음을 마지막으로 확인한 시각 (ISO). Phase 4.1b. */
  lastHeartbeatAt?: string;
  /** max(lastEventAt, lastHeartbeatAt) */
  lastSeenAt?: string;
  /** lastSeenAt 이후 경과 분 */
  minutesSinceSeen?: number;
  computedAt: string;
}
