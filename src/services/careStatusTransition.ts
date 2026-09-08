/**
 * 두 careStatus 스냅샷 비교 → **상태 전환 감지** (Phase 4.3 STEP B-3).
 *
 * 순수 함수. firebase / fetch / Worker env / `Date.now()` import 없음.
 * 같은 입력 → 같은 출력. Worker(esbuild) · Node 스모크 모두 import 가능.
 *
 * ── 무엇이 "전환" 인가 ────────────────────────────────────────────────
 *  전환 identity 는 **두 축의 상태 값만**:
 *    · 사람 축: `status`        (NORMAL / CHECK / EMERGENCY)
 *    · 기기 축: `deviceHealth`  (online / offline / unknown)
 *  두 축은 **독립적으로** 감지한다. 한 축이 바뀌어도 다른 축을 건드리지 않는다.
 *  (예: person NORMAL 유지 + device online→offline → deviceTransition 만.
 *   사람 상태를 CHECK 로 변조하지 않는다.)
 *
 * ── reason 변화는 전환이 아니다 ──────────────────────────────────────
 *  `CHECK/inactivity → CHECK/no_data`, `offline/heartbeat_stale → offline/…`
 *  같은 reason-only 변화는 **알림 트리거용 전환으로 보지 않는다**. reason 은
 *  metadata 로 스냅샷 문서에 보존되지만 이 detector 의 판정 기준에는 안 들어간다.
 *  (reason-sensitive 정책이 필요하면 그때 별도 설계 — 이번 단계에서 안 만든다.)
 *
 * ── 초기 스냅샷 ──────────────────────────────────────────────────────
 *  이전 스냅샷이 없으면(첫 계산) `isInitial: true`, 두 transition 모두 `null`,
 *  `changed: false`. 최초 계산은 **baseline seed** 로 보고 전환 알림 대상이 아니다.
 *  ("이전 없음 → NORMAL" 을 "UNKNOWN → NORMAL 알림" 으로 만들지 않는다.
 *   최초 EMERGENCY 도 이번 단계에서는 알림 아님 — Phase 4.4 에서 재검토 가능.)
 *
 * ⚠️ 이 파일은 전환을 **감지만** 한다. FCM · notification write · transition history
 *    write 는 없다. 결과는 함수 반환값으로만 존재한다 (Phase 4.4 FCM 이 소비).
 */

import type { CareStatus, DeviceHealth } from '../types/status';

/**
 * 런타임 검증용 값 목록 — `types/status.ts` 의 `CareStatus` / `DeviceHealth` 와 동기화.
 * (컴파일 타임 union 만으로는 Worker 가 Firestore 에서 읽은 문자열을 못 거른다.)
 */
export const CARE_STATUS_VALUES = ['NORMAL', 'CHECK', 'EMERGENCY'] as const;
export const DEVICE_HEALTH_VALUES = ['online', 'offline', 'unknown'] as const;

// union 과 배열이 어긋나면 컴파일 에러 (드리프트 방지).
const _careStatusExhaustive: readonly CareStatus[] = CARE_STATUS_VALUES;
const _deviceHealthExhaustive: readonly DeviceHealth[] = DEVICE_HEALTH_VALUES;
void _careStatusExhaustive;
void _deviceHealthExhaustive;

export function isCareStatus(value: unknown): value is CareStatus {
  return (
    typeof value === 'string' &&
    (CARE_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function isDeviceHealth(value: unknown): value is DeviceHealth {
  return (
    typeof value === 'string' &&
    (DEVICE_HEALTH_VALUES as readonly string[]).includes(value)
  );
}

/** 전환 판정에 실제로 쓰는 필드만. `CareStatusSnapshotDoc` 가 구조적으로 이걸 만족한다. */
export interface CareStatusIdentity {
  status: CareStatus;
  deviceHealth: DeviceHealth;
}

export interface PersonStatusTransition {
  from: CareStatus;
  to: CareStatus;
}

export interface DeviceHealthTransition {
  from: DeviceHealth;
  to: DeviceHealth;
}

/** 두 스냅샷 비교 결과. 두 축을 독립적으로 담는다. 새 enum 없음. */
export interface CareStatusTransitionResult {
  /** 이전 스냅샷이 없어 baseline seed 인가 (전환 알림 대상 아님). */
  isInitial: boolean;
  /** 사람 축 status 가 바뀌었으면 { from, to }, 아니면 null. */
  personTransition: PersonStatusTransition | null;
  /** 기기 축 deviceHealth 가 바뀌었으면 { from, to }, 아니면 null. */
  deviceTransition: DeviceHealthTransition | null;
  /** personTransition != null || deviceTransition != null. isInitial 이면 항상 false. */
  changed: boolean;
}

/**
 * 이전 스냅샷(없으면 null) 과 새로 계산된 스냅샷의 상태 값을 비교한다.
 *
 * @param previous  직전 careStatus 스냅샷 identity, 또는 첫 계산이면 null
 * @param next      새로 계산된 스냅샷 identity
 * @returns 두 축의 독립 전환 결과
 */
export function deriveCareStatusTransition(
  previous: CareStatusIdentity | null | undefined,
  next: CareStatusIdentity,
): CareStatusTransitionResult {
  if (previous == null) {
    // 첫 계산 = baseline seed. 전환 아님.
    return {
      isInitial: true,
      personTransition: null,
      deviceTransition: null,
      changed: false,
    };
  }

  const personTransition: PersonStatusTransition | null =
    previous.status !== next.status
      ? { from: previous.status, to: next.status }
      : null;

  const deviceTransition: DeviceHealthTransition | null =
    previous.deviceHealth !== next.deviceHealth
      ? { from: previous.deviceHealth, to: next.deviceHealth }
      : null;

  return {
    isInitial: false,
    personTransition,
    deviceTransition,
    changed: personTransition != null || deviceTransition != null,
  };
}
