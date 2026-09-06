/**
 * 서버에서도 그대로 쓸 수 있는 **순수 상태 판정 코어** (Phase 4.3 STEP A).
 *
 * 목적: 보호자 앱이 실행 중이 아니어도 Cloudflare Worker(cron, STEP B 이후)가
 * "지금 상태"를 클라이언트와 **완전히 동일한 규칙**으로 계산할 수 있게 한다.
 *
 * ── 설계 원칙 ──────────────────────────────────────────────────────────
 *  - 판정 규칙을 새로 만들지 않는다. 이미 검증된 순수 함수를 그대로 조합한다:
 *      · deriveCareStatus   (careStatus.ts)   — 사람 축 NORMAL/CHECK/EMERGENCY
 *      · deriveDeviceHealth (deviceHealth.ts) — 기기 축 online/offline/unknown
 *  - 두 축은 careStore.project() 와 **동일한 입력으로 동일하게** 호출한다.
 *    (project() 의 오버라이드 / presentHome / 이벤트 스캔은 클라이언트 UI 전용이라 제외.
 *     이벤트 스캔 결과 = lastActivityAt / lastSosAt / hasAnyEvents 는 어댑터가 넣는다.)
 *  - Firebase 객체 / React / Zustand / env 참조 없음. threshold 는 **명시 주입**한다.
 *    서버는 EXPO_PUBLIC_* 나 careStatusConfig 를 절대 참조하지 않는다.
 *  - now 는 주입 가능. Date.now() 를 내부에서 직접 부르지 않는다 (결정적 테스트).
 *  - 저장 timestamp 는 UTC instant. 경과 분은 instant 차이. "오늘 날짜" 같은
 *    local-day 계산은 이 판정에 넣지 않는다 (그건 Home UX "오늘 활동" 전용).
 *  - 미래 timestamp 등 비정상 입력에 대한 새 안전정책을 만들지 않는다 —
 *    deriveCareStatus / deriveDeviceHealth 의 기존 동작을 그대로 따른다.
 */

import type { CareStatusResult, DeviceHealthResult } from '../types/status';
import type { CareStatusConfig } from '../config/careStatusConfig';
import { deriveCareStatus } from './careStatus.ts';
import { deriveDeviceHealth } from './deviceHealth.ts';

/**
 * 상태 판정 임계값. **반드시 명시 주입한다** — 서버는 EXPO_PUBLIC_* / careStatusConfig 를
 * 참조하지 않는다. 운영값 확정은 STEP B-2 이후 (Worker vars/config).
 */
export interface CareStatusThresholds {
  /** 마지막 활동 이후 이 분(minutes)을 넘기면 CHECK. (앱 코드 기본값 180) */
  inactivityMinutes: number;
  /** heartbeat 가 이 분 이내면 online, 초과면 offline. (앱 코드 기본값 25) */
  deviceOfflineMinutes: number;
  /** sos 를 "최근"으로 볼 시간(hours). (앱 코드 기본값 12) */
  emergencyLookbackHours: number;
  /** sos 가 이 시간(hours)을 넘으면 EMERGENCY 자동 만료. (앱 코드 기본값 12) */
  emergencyTtlHours: number;
}

/** 서버 판정에 필요한 정규화된 입력. Firestore 문서 전체가 아니라 이 형태만 넘긴다. */
export interface CareStatusSnapshotInput {
  /** 마지막 "활동" 이벤트 시각 (ISO). 어댑터가 ACTIVITY_EVENT_TYPES 로 스캔해 넣는다. */
  lastActivityAt?: string;
  /** 마지막 sos_triggered 이벤트 시각 (ISO). */
  lastSosAt?: string;
  /** 사람 이벤트가 하나라도 있는가 (0건이면 systemHealth unknown / reason no_data). */
  hasAnyEvents: boolean;
  /** EMERGENCY 확인(ack) 시각 (epoch ms 또는 ISO). sos 시각 이후면 EMERGENCY 해제. */
  emergencyAckedAt?: number | string;

  /** devices/{id} 문서 존재 여부. */
  deviceDocExists: boolean;
  /** devices/{id}.lastEventAt (ISO). */
  deviceLastEventAt?: string;
  /** devices/{id}.lastHeartbeatAt (ISO). 없으면 heartbeat 신호 없음 → unknown. */
  lastHeartbeatAt?: string;

  thresholds: CareStatusThresholds;
}

/** 서버 판정 결과. 두 축을 독립적으로 담는다. 새 enum 없음. */
export interface CareStatusSnapshot {
  /** 사람 축 — deriveCareStatus 결과 그대로 */
  person: CareStatusResult;
  /** 기기 축 — deriveDeviceHealth 결과 그대로 */
  device: DeviceHealthResult;
  /** 이 스냅샷을 계산한 시각 (ISO) */
  computedAt: string;
}

/**
 * 정규화된 입력 + now → 두 축 상태 스냅샷.
 *
 * careStore.project() 가 deriveCareStatus / deriveDeviceHealth 를 호출하는 것과
 * **정확히 같은 인자**로 호출한다. (parity 는 scripts/phase43-server-carestatus-smoke.mjs)
 */
export function computeCareStatusSnapshot(
  input: CareStatusSnapshotInput,
  now: Date = new Date(),
): CareStatusSnapshot {
  const t = input.thresholds;

  // deriveCareStatus 는 CareStatusConfig 전체 타입을 받지만 실제로는
  // inactivityCheckMinutes / emergencyLookbackHours / emergencyTtlHours 만 쓴다.
  // 나머지 필드(재계산 주기 / 오버라이드 TTL)는 판정에 미사용 → 0.
  const careConfig: CareStatusConfig = {
    inactivityCheckMinutes: t.inactivityMinutes,
    emergencyLookbackHours: t.emergencyLookbackHours,
    emergencyTtlHours: t.emergencyTtlHours,
    deviceOfflineMinutes: t.deviceOfflineMinutes,
    recomputeIntervalMs: 0,
    overrideTtlMs: 0,
  };

  const person = deriveCareStatus({
    lastActivityAt: input.lastActivityAt,
    lastSosAt: input.lastSosAt,
    totalEventCount: input.hasAnyEvents ? 1 : 0,
    config: careConfig,
    now,
    emergencyAckedAt: input.emergencyAckedAt,
  });

  const device = deriveDeviceHealth({
    deviceDocExists: input.deviceDocExists,
    lastEventAt: input.deviceLastEventAt,
    lastHeartbeatAt: input.lastHeartbeatAt,
    config: { deviceOfflineMinutes: t.deviceOfflineMinutes },
    now,
  });

  return { person, device, computedAt: now.toISOString() };
}
