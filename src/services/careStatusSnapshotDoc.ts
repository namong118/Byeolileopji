/**
 * `CareStatusSnapshot` → Firestore 저장용 평문 문서 (Phase 4.3 STEP B-2).
 *
 * 순수 함수. firebase / react import 없음 → Worker(esbuild) · Node 스모크 모두 import 가능.
 *
 * ── 왜 별도 파일인가 ──────────────────────────────────────────────────
 *  STEP A 코어(`computeCareStatusSnapshot`)는 "판정 결과"를 만들고,
 *  이 파일은 그 결과를 "저장 가능한 형태"로 **직렬화만** 한다. 판정 규칙 없음.
 *  compute(순수) / serialize(순수) / write(I/O — `careStatusWriter.js`) 를 나눠
 *  serialize 를 단독 테스트한다. (STEP 10 원칙)
 *
 * ── 저장 위치 ─────────────────────────────────────────────────────────
 *  `careStatus/{careRecipientId}` — `devices/{deviceId}` 와 같은 레벨의 top-level
 *  컬렉션, 문서 id = careRecipientId.
 *   - raw(events / devices) 와 derived(careStatus) 를 **컬렉션 단위로 분리**.
 *   - 대상자당 문서 **1개** → event history 처럼 새 문서를 쌓지 않는다.
 *   - 같은 대상자 재계산 = 같은 문서 덮어쓰기 → **idempotent**.
 *   - STEP B-3 이 "이전 스냅샷"을 읽으려면 `GET careStatus/{id}` point read 1회.
 *  (README STEP B-2 계획 노트의 `careRecipients/{id}` 하위 서브컬렉션 대신 top-level 을
 *   골랐다 — 앱의 기존 `devices/{id}` 레지스트리 패턴과 일치하고 rules 블록도 1개면 된다.)
 *
 * ── timestamp ────────────────────────────────────────────────────────
 *  ISO 문자열은 `Date` 로 되돌려 담는다 → `firestore.js` 의 `toFirestoreValue` 가
 *  `timestampValue` 로 변환한다 (`events.occurredAt` / `devices.lastHeartbeatAt` 와 동일).
 *  잘못된/없는 시각은 `null` — **now 로 대체하지 않는다** (STEP B-1 신호 비조작 원칙 유지).
 *
 * ── optional 필드 ────────────────────────────────────────────────────
 *  스키마의 **모든 키를 항상 emit** 한다. 값이 없으면 `null`.
 *  → 이전 스냅샷이 무엇이었든 같은 입력이면 동일한 문서가 된다 (deterministic overwrite;
 *    `careStatusWriter.js` 가 updateMask 로 전체 필드를 replace).
 *  → `undefined` / `NaN` 같은 값이 Firestore 에 들어가지 않는다.
 *  `null` = "이번 판정에는 해당 없음" (예: NORMAL 스냅샷의 `emergencyEventAt`).
 */

import type { CareStatusSnapshot } from './careStatusSnapshot.ts';
import type {
  CareStatus,
  CareStatusReason,
  DeviceHealth,
  DeviceHealthReason,
  SystemHealth,
} from '../types/status';

/** 스냅샷 문서 스키마 버전. 필드 의미가 바뀌면 올린다 (읽는 쪽이 분기할 수 있게). */
export const CARE_STATUS_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * `careStatus/{careRecipientId}` 문서의 평문 형태.
 *
 * timestamp 는 `Date`(→ Firestore `timestampValue`), 없으면 `null`.
 * 새 상태 enum 을 만들지 않는다 — `CareStatusResult` / `DeviceHealthResult` 의 필드를
 * 접두사(`device*`)로 평탄화해 담을 뿐이다. (중첩 map 대신 flat → 콘솔 가독성 +
 * STEP B-3 의 이전/신규 비교가 `===` 몇 개로 끝난다.)
 */
export interface CareStatusSnapshotDoc {
  /** 대상자 id. 문서 id 와 동일하지만 필드로도 저장한다 (Phase 4.4 rules 조건 / 쿼리용). */
  careRecipientId: string;
  schemaVersion: number;

  // ── 사람 축 (deriveCareStatus 결과) ──────────────────────────────────
  status: CareStatus;
  reason: CareStatusReason;
  /** 사람 데이터 가용성 (기기 상태 아님). events 0건 → 'unknown'. */
  systemHealth: SystemHealth;
  lastActivityAt: Date | null;
  minutesSinceActivity: number | null;
  /** EMERGENCY 를 유발한 sos 이벤트 시각. EMERGENCY 가 아니면 null. */
  emergencyEventAt: Date | null;

  // ── 기기 축 (deriveDeviceHealth 결과) ────────────────────────────────
  deviceHealth: DeviceHealth;
  deviceHealthReason: DeviceHealthReason;
  deviceLastEventAt: Date | null;
  deviceLastHeartbeatAt: Date | null;
  deviceLastSeenAt: Date | null;
  deviceMinutesSinceSeen: number | null;

  // ── 메타 ────────────────────────────────────────────────────────────
  /** 이 스냅샷을 계산한 시각 (= 판정 기준 시각, snapshot.computedAt). */
  computedAt: Date;
}

/** 유효한 ISO 문자열이면 `Date`, 아니면 `null`. now 로 대체하지 않는다. */
function dateOrNull(value: string | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** 유한한 숫자면 그대로, 아니면 `null`. */
function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 판정 결과 + 대상자 id → 저장용 평문 문서.
 *
 * 순수 / 결정적: 같은 `snapshot` + 같은 `careRecipientId` → 항상 같은 문서.
 * (write 시각 같은 비결정적 필드를 넣지 않는다 — `computedAt` 은 snapshot 에서 온다.)
 *
 * @throws careRecipientId 가 비었거나 `snapshot.computedAt` 이 유효하지 않으면.
 */
export function serializeCareStatusSnapshot(
  snapshot: CareStatusSnapshot,
  careRecipientId: string,
): CareStatusSnapshotDoc {
  if (typeof careRecipientId !== 'string' || careRecipientId.trim() === '') {
    throw new Error('serializeCareStatusSnapshot: careRecipientId required');
  }

  const computedAt = dateOrNull(snapshot.computedAt);
  if (computedAt == null) {
    throw new Error(
      `serializeCareStatusSnapshot: invalid snapshot.computedAt (${String(snapshot.computedAt)})`,
    );
  }

  const { person, device } = snapshot;

  return {
    careRecipientId,
    schemaVersion: CARE_STATUS_SNAPSHOT_SCHEMA_VERSION,

    status: person.status,
    reason: person.reason,
    systemHealth: person.systemHealth,
    lastActivityAt: dateOrNull(person.lastActivityAt),
    minutesSinceActivity: numberOrNull(person.minutesSinceActivity),
    emergencyEventAt: dateOrNull(person.emergencyEventAt),

    deviceHealth: device.health,
    deviceHealthReason: device.reason,
    deviceLastEventAt: dateOrNull(device.lastEventAt),
    deviceLastHeartbeatAt: dateOrNull(device.lastHeartbeatAt),
    deviceLastSeenAt: dateOrNull(device.lastSeenAt),
    deviceMinutesSinceSeen: numberOrNull(device.minutesSinceSeen),

    computedAt,
  };
}
