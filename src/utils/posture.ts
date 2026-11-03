/**
 * XIAO 자세 인식 데모 — 자세 표시 문구 + "확인이 필요해요" 배지 계산 (순수 함수).
 *
 * - 자세는 CareEvent.metadata.posture / .confidence 에 있다 (Worker 가 payload 로 저장).
 * - 펌웨어는 자세가 **바뀔 때만** 전송한다. 누운 뒤에는 새 이벤트가 오지 않으므로
 *   배지는 "마지막 자세 이벤트가 lying 인 시각부터 now 까지의 경과"로 계산한다.
 *   호출자(usePostureAlert)가 1초 주기로 now 를 바꿔 다시 부른다.
 * - 화면 표시 전용. 서버 상태 판정(NORMAL/CHECK/EMERGENCY)과 연결하지 않는다.
 * - React Native 의존성 없음 (Node smoke 에서 직접 import).
 */

import type { CareEvent } from '../types/events';

export type Posture = 'standing' | 'sitting' | 'lying';

const POSTURES: readonly Posture[] = ['standing', 'sitting', 'lying'];

export const POSTURE_LABEL: Record<Posture, string> = {
  standing: '서 있음',
  sitting: '앉아 있음',
  lying: '누워 있음',
};

const POSTURE_PHRASE: Record<Posture, string> = {
  standing: '서 있어요',
  sitting: '앉아 있어요',
  lying: '누워 있어요',
};

/** 누워 있어도 정상인 방 (devices 문서 location 값) */
export const BED_LOCATION = '침대';

export const DEFAULT_LYING_ALERT_SECONDS = 30;

export interface PostureReading {
  posture: Posture;
  confidence?: number;
}

export function readPosture(event: CareEvent): PostureReading | null {
  const p = event.metadata?.posture;
  if (typeof p !== 'string' || !(POSTURES as readonly string[]).includes(p)) return null;
  const c = event.metadata?.confidence;
  return {
    posture: p as Posture,
    confidence: typeof c === 'number' && Number.isFinite(c) ? c : undefined,
  };
}

/** 예: "거실에서 앉아 있어요." / "침대에 누워 있어요." */
export function postureMessage(location: string | undefined, posture: Posture): string {
  const place = location ?? '집';
  const particle = place === BED_LOCATION ? '에' : '에서';
  return `${place}${particle} ${POSTURE_PHRASE[posture]}.`;
}

export interface PostureAlert {
  /** 가장 최근 자세 이벤트 (없으면 null) */
  latest: (PostureReading & { location?: string; occurredAt: string; eventId: string }) | null;
  /** 침대가 아닌 방에서 lying 이 threshold 이상 지속 */
  needsCheck: boolean;
  /** latest 가 lying 일 때 그 시각부터의 경과(ms). 아니면 0 */
  lyingElapsedMs: number;
}

/**
 * @param events 순서 무관. metadata.posture 가 있는 이벤트만 본다.
 * @param thresholdMs lying 지속 기준 (기본 30초)
 */
export function computePostureAlert(
  events: readonly CareEvent[],
  now: Date,
  thresholdMs: number = DEFAULT_LYING_ALERT_SECONDS * 1000,
): PostureAlert {
  let latest: PostureAlert['latest'] = null;
  let latestMs = -Infinity;
  for (const e of events) {
    const r = readPosture(e);
    if (!r) continue;
    const t = Date.parse(e.occurredAt);
    if (!Number.isFinite(t) || t <= latestMs) continue;
    latestMs = t;
    latest = { ...r, location: e.location, occurredAt: e.occurredAt, eventId: e.id };
  }
  if (!latest || latest.posture !== 'lying') {
    return { latest, needsCheck: false, lyingElapsedMs: 0 };
  }
  const lyingElapsedMs = Math.max(0, now.getTime() - latestMs);
  const needsCheck = latest.location !== BED_LOCATION && lyingElapsedMs >= thresholdMs;
  return { latest, needsCheck, lyingElapsedMs };
}

/** 지속 시간 표시: 60초 미만 "N초째", 60분 미만 "N분째", 그 이상 "N시간 M분째" */
export function formatElapsedKorean(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}초째`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}분째`;
  return `${Math.floor(totalMin / 60)}시간 ${totalMin % 60}분째`;
}
