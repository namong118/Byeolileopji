/**
 * 기기 상태 판정 규칙 (순수 함수) — **사람 축(careStatus.ts)과 완전히 독립**.
 *
 * 입력은 "몇 개의 타임스탬프 + 설정"뿐. firebase / react import 없음 → 단독 테스트 가능.
 *
 * 핵심 원칙:
 *  - lastHeartbeatAt 이 없으면(=heartbeat 신호가 아직 없음) **항상 unknown** 이다.
 *    lastEventAt 이 아무리 오래돼도 offline 으로 판정하지 않는다.
 *    (사람이 오래 가만히 있는 것과 센서가 죽은 것을 heartbeat 없이 구분할 수 없기 때문)
 *  - lastHeartbeatAt 이 있으면 config.deviceOfflineMinutes 기준으로 online/offline.
 *
 * Phase 4.1b: ESP32 가 /device-heartbeat 로 주기적 heartbeat 를 보내면 Worker 가
 *   devices/{id}.lastHeartbeatAt 을 갱신한다 → 이 함수가 online/offline 을 실제로 판정한다.
 */

import type { DeviceHealth, DeviceHealthResult } from '../types/status';

export interface DeriveDeviceHealthInput {
  /** devices/{id} 문서가 존재하는가 */
  deviceDocExists: boolean;
  /** devices/{id}.lastEventAt (ISO). Worker 가 /ingest-device-event 성공 시 갱신. */
  lastEventAt?: string;
  /** devices/{id}.lastHeartbeatAt (ISO). Worker 가 /device-heartbeat 성공 시 갱신. 없으면 heartbeat 신호 없음. */
  lastHeartbeatAt?: string;
  /** heartbeat 가 이 시간(분) 이내면 online, 초과면 offline */
  config: { deviceOfflineMinutes: number };
  now?: Date;
}

function maxDefined(a?: number, b?: number): number | undefined {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

export function deriveDeviceHealth(
  input: DeriveDeviceHealthInput,
): DeviceHealthResult {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const lastEventMs = input.lastEventAt
    ? new Date(input.lastEventAt).getTime()
    : undefined;
  const lastHbMs = input.lastHeartbeatAt
    ? new Date(input.lastHeartbeatAt).getTime()
    : undefined;

  const lastSeenMs = maxDefined(lastEventMs, lastHbMs);
  const lastSeenAt =
    lastSeenMs != null ? new Date(lastSeenMs).toISOString() : undefined;
  const minutesSinceSeen =
    lastSeenMs != null ? Math.floor((nowMs - lastSeenMs) / 60_000) : undefined;

  const base = {
    lastEventAt: input.lastEventAt,
    lastHeartbeatAt: input.lastHeartbeatAt,
    lastSeenAt,
    minutesSinceSeen,
    computedAt: now.toISOString(),
  };

  const unknown = (
    reason: DeviceHealthResult['reason'],
  ): DeviceHealthResult => ({ ...base, health: 'unknown' as DeviceHealth, reason });

  // devices/{id} 문서 없음 → unknown
  if (!input.deviceDocExists) return unknown('no_device_doc');

  // heartbeat 신호가 아직 없음 → unknown (lastEventAt 이 오래돼도 offline 아님)
  if (lastHbMs == null) return unknown('no_heartbeat_capability');

  // heartbeat 신호가 있으면 online/offline 판정
  const hbMinutes = Math.floor((nowMs - lastHbMs) / 60_000);
  if (hbMinutes <= input.config.deviceOfflineMinutes) {
    return { ...base, health: 'online', reason: 'heartbeat_fresh' };
  }
  return { ...base, health: 'offline', reason: 'heartbeat_stale' };
}
