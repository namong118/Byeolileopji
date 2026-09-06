/**
 * 서버 상태 판정 — READ + NORMALIZE + COMPUTE (Phase 4.3 STEP B-1).
 *
 *   Firestore (events, devices/{id})
 *        │  readCareStatusSource()          ← firestoreRead.js, READ ONLY
 *        ▼
 *   { events, device }
 *        │  normalizeCareStatusInput()      ← src/services/careStatusSnapshotInput.ts (공유, 순수)
 *        ▼
 *   CareStatusSnapshotInput
 *        │  computeCareStatusSnapshot()     ← src/services/careStatusSnapshot.ts (STEP A 공유 코어)
 *        ▼
 *   CareStatusSnapshot  { person, device, computedAt }
 *
 * ⚠️ 이 파일은 Firestore WRITE 를 하지 않는다. cron / scheduled() 도 여기 없다.
 *    STEP B-2 에서 scheduled() 가 computeCareStatusFromFirestore() 를 호출하고
 *    결과를 Firestore 에 저장 + 이전 스냅샷과 비교하게 된다.
 *
 * ⚠️ 사람/기기 상태를 여기서 다시 계산하지 않는다. STEP A 공유 코어만 쓴다.
 */

import { queryRecentEvents, readDeviceDoc } from './firestoreRead.js';
import { normalizeCareStatusInput } from '../../../src/services/careStatusSnapshotInput.ts';
import { computeCareStatusSnapshot } from '../../../src/services/careStatusSnapshot.ts';

/** 상태 판정에 필요한 최소 데이터만 Firestore 에서 읽는다. WRITE 없음. */
export async function readCareStatusSource(env, { careRecipientId, deviceId, eventLimit = 100 }) {
  if (!careRecipientId) throw new Error('careRecipientId required');
  if (!deviceId) throw new Error('deviceId required');

  // 두 번의 read: events 쿼리 1회 + devices point read 1회.
  const [events, device] = await Promise.all([
    queryRecentEvents(env, careRecipientId, eventLimit),
    readDeviceDoc(env, deviceId),
  ]);

  return { events, device };
}

/**
 * READ → normalize → 공유 코어 compute. 한 곳에서 전체 흐름이 보이는 얇은 service.
 * STEP B-2 의 scheduled() 가 이 함수를 한 줄로 호출한다.
 *
 * @param env  Worker env (FIREBASE_PROJECT_ID 등)
 * @param opts.careRecipientId  대상자 ID (Auth 도입 전까지 호출자가 명시 — Worker 하드코딩 금지)
 * @param opts.deviceId         기기 ID (동일)
 * @param opts.thresholds       { inactivityMinutes, deviceOfflineMinutes, emergencyLookbackHours, emergencyTtlHours }
 * @param opts.now              Date. 미지정 시 new Date() (scheduled() 는 실행 시각을 넣는다)
 * @param opts.eventLimit       events 쿼리 limit (기본 100)
 * @returns { input, snapshot }
 */
export async function computeCareStatusFromFirestore(env, opts) {
  const { careRecipientId, deviceId, thresholds, now = new Date(), eventLimit = 100 } = opts;
  if (!thresholds) throw new Error('thresholds required (서버는 env threshold 를 참조하지 않는다)');

  const source = await readCareStatusSource(env, { careRecipientId, deviceId, eventLimit });
  const input = normalizeCareStatusInput(source, thresholds);
  const snapshot = computeCareStatusSnapshot(input, now);

  return { input, snapshot };
}
