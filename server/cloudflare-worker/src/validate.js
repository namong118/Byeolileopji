/**
 * 순수 검증 로직 (네트워크/Firestore 접근 없음).
 *
 * ⚠️ DEVELOPMENT / POC DEVICE AUTH — NOT PRODUCTION READY
 *   - 공유 device key(X-Device-Key) 1개로만 인증한다. per-device key / 회전 / replay 방지 없음.
 *   - Phase 4 에서 강화.
 *
 * 이벤트 타입 값은 반드시 앱의 CareEvent 도메인 모델(src/types/events.ts)과 일치해야 한다.
 * 새 대문자 enum 을 만들지 않는다.
 */

/** 앱 CareEvent.eventType 과 동일 (소문자 snake_case) */
export const ALLOWED_EVENT_TYPES = [
  'motion_detected',
  'door_opened',
  'left_home',
  'returned_home',
  'medication_taken',
  'medication_missed',
  'watch_activity',
  'sos_triggered',
];

/** devices 레지스트리의 type 값 */
export const ALLOWED_DEVICE_TYPES = ['ESP32_PIR', 'ESP32_DOOR'];

/** 디바이스 종류별로 보낼 수 있는 이벤트 타입 제한 */
export const DEVICE_TYPE_EVENTS = {
  ESP32_PIR: ['motion_detected'],
  ESP32_DOOR: ['door_opened'],
};

function fail(status, error) {
  return { ok: false, status, error };
}

/** 타이밍 공격을 조금이라도 줄이기 위한 상수 시간 비교 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 1단계: HTTP 요청 자체 검증 (method / key / JSON body).
 * @returns {{ok:true, deviceId:string, eventType:string} | {ok:false, status:number, error:string}}
 */
export function validateRequest({ method, deviceKeyHeader, body }, { expectedDeviceKey }) {
  if (method !== 'POST') return fail(405, 'method_not_allowed');
  if (!expectedDeviceKey) return fail(500, 'server_misconfigured_no_device_key');
  if (!safeEqual(deviceKeyHeader || '', expectedDeviceKey)) {
    return fail(401, 'invalid_device_key');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'invalid_json_body');
  }

  const { deviceId, eventType } = body;
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    return fail(400, 'missing_deviceId');
  }
  if (typeof eventType !== 'string' || eventType.trim() === '') {
    return fail(400, 'missing_eventType');
  }
  if (!ALLOWED_EVENT_TYPES.includes(eventType)) {
    return fail(400, 'unsupported_eventType');
  }
  return { ok: true, deviceId: deviceId.trim(), eventType };
}

/**
 * 2단계: devices 레지스트리 조회 결과 검증.
 * @param device Firestore devices/{deviceId} 문서를 평문 객체로 변환한 것 (없으면 null)
 * @returns {{ok:true} | {ok:false, status:number, error:string}}
 */
export function validateDevice(device, eventType) {
  if (!device) return fail(404, 'device_not_found');
  if (device.enabled !== true) return fail(403, 'device_disabled');

  if (typeof device.careRecipientId !== 'string' || device.careRecipientId.trim() === '') {
    return fail(422, 'device_missing_careRecipientId');
  }

  if (device.type != null) {
    if (!ALLOWED_DEVICE_TYPES.includes(device.type)) {
      return fail(422, 'unsupported_device_type');
    }
    const allowed = DEVICE_TYPE_EVENTS[device.type];
    if (allowed && !allowed.includes(eventType)) {
      return fail(422, 'event_type_not_allowed_for_device');
    }
  }
  return { ok: true };
}
