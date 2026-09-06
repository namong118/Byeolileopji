/**
 * Firestore READ 결과 → `computeCareStatusSnapshot` 입력 정규화 (Phase 4.3 STEP B-1).
 *
 * 순수 함수. firebase/react import 없음. Worker(esbuild) / Node 스모크 모두 import 가능.
 *
 * ── ACTIVITY 의미는 클라이언트와 **동일** ─────────────────────────────
 *  서버 inactivity 판정의 lastActivityAt 은 `eventViews.ts` 의 `ACTIVITY_EVENT_TYPES`
 *  (motion/door/left/returned/watch/medication_taken)를 **그대로 공유 import** 한다.
 *  Home UX 의 `DAILY_LIVING_ACTIVITY_EVENT_TYPES`(모션/문/외출/귀가) 와 다르다 —
 *  그건 홈 "오늘 활동 N번" 표시 전용이고 서버 판정에는 쓰지 않는다.
 *
 * ── emergencyAckedAt ──────────────────────────────────────────────────
 *  현재 데이터 모델에는 서버가 읽을 수 있는 ack 저장소가 없다. 앱의
 *  `acknowledgeEmergency()` 는 careStore 클라이언트 전용 dev 플래그로 Firestore 에
 *  저장되지 않는다. → 서버는 항상 `undefined` 로 둔다. 서버 EMERGENCY 는 TTL 로만
 *  만료된다. (지속 ack 설계는 STEP B-2 이후.)
 */

import type {
  CareStatusSnapshotInput,
  CareStatusThresholds,
} from './careStatusSnapshot.ts';
import { ACTIVITY_EVENT_TYPES } from './eventViews.ts';

/** Firestore READ 원본 (Worker 어댑터가 REST 응답에서 뽑아 넣는다). */
export interface CareStatusSource {
  /** 대상자(careRecipientId) 이벤트. 정렬 순서는 신경쓰지 않아도 된다 (여기서 정렬). */
  events: readonly { eventType?: string; occurredAt?: string }[];
  /** devices/{deviceId} 문서. 문서가 없으면 null. */
  device: { lastEventAt?: string; lastHeartbeatAt?: string } | null;
}

/** 유효한 시각 문자열이면 ISO instant, 아니면 undefined. **now 로 대체하지 않는다.** */
export function toInstantIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function normalizeCareStatusInput(
  source: CareStatusSource,
  thresholds: CareStatusThresholds,
): CareStatusSnapshotInput {
  const raw = source.events ?? [];

  // occurredAt 내림차순 (최신 우선). 파싱 불가한 시각은 맨 뒤로 밀린다.
  const events = [...raw].sort((a, b) => {
    const ta = Date.parse(a?.occurredAt ?? '') || 0;
    const tb = Date.parse(b?.occurredAt ?? '') || 0;
    return tb - ta;
  });

  // 서버는 문자열 그대로 다룬다 (Firestore 원본). ACTIVITY_EVENT_TYPES 는 앱과 동일한 Set.
  const activityTypes = ACTIVITY_EVENT_TYPES as ReadonlySet<string>;

  let lastActivityAt: string | undefined;
  let lastSosAt: string | undefined;
  for (const e of events) {
    const at = toInstantIso(e?.occurredAt);
    if (at == null) continue;
    if (lastActivityAt == null && e.eventType && activityTypes.has(e.eventType)) {
      lastActivityAt = at;
    }
    if (lastSosAt == null && e.eventType === 'sos_triggered') {
      lastSosAt = at;
    }
    if (lastActivityAt != null && lastSosAt != null) break;
  }

  const device = source.device;

  return {
    lastActivityAt,
    lastSosAt,
    hasAnyEvents: events.length > 0,
    emergencyAckedAt: undefined, // 서버가 읽을 수 있는 ack 저장소 없음 (위 주석)
    deviceDocExists: device != null,
    deviceLastEventAt: device ? toInstantIso(device.lastEventAt) : undefined,
    lastHeartbeatAt: device ? toInstantIso(device.lastHeartbeatAt) : undefined,
    thresholds,
  };
}
