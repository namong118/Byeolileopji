/**
 * 순수 로직: 검증을 통과한 디바이스 이벤트 → Firestore `events` 문서(평문 객체).
 *
 * - 시간(occurredAt / createdAt)은 서버가 생성한다. ESP32 시계(RTC/NTP)에 의존하지 않는다.
 * - careRecipientId / location 은 devices 레지스트리에서 온다. ESP32 는 보내지 않는다.
 * - source / payload.origin 은 서버가 채운다.
 * - eventType / source 값은 앱 CareEvent 도메인 모델과 동일한 소문자 snake_case.
 */

/** 이벤트 타입 → CareEvent.source (현재 PIR/도어 센서는 모두 'sensor') */
function sourceForEventType(eventType) {
  switch (eventType) {
    case 'watch_activity':
      return 'watch';
    case 'medication_taken':
    case 'medication_missed':
      return 'medication';
    default:
      return 'sensor';
  }
}

/**
 * posture / confidence / snapshotSeq(선택)는 payload 에 덧붙인다 → 앱 CareEvent.metadata.
 * 모두 없으면 payload 는 예전과 동일하다.
 *
 * @param {{ deviceId: string, eventType: string, device: object, now?: Date, posture?: string, confidence?: number, snapshotSeq?: number }} args
 * @returns 평문 이벤트 객체 (occurredAt/createdAt 은 Date — firestore.js 가 timestampValue 로 변환)
 */
export function buildEventDoc({ deviceId, eventType, device, now = new Date(), posture, confidence, snapshotSeq }) {
  const location =
    typeof device.location === 'string' && device.location.trim() !== ''
      ? device.location
      : null;

  return {
    careRecipientId: device.careRecipientId,
    deviceId,
    eventType,
    source: sourceForEventType(eventType),
    location,
    payload: {
      origin: 'esp32',
      deviceType: device.type ?? null,
      ...(posture !== undefined ? { posture } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(snapshotSeq !== undefined ? { snapshotSeq } : {}),
    },
    occurredAt: now,
    createdAt: now,
  };
}
