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
export const ALLOWED_DEVICE_TYPES = ['ESP32_PIR', 'ESP32_DOOR', 'ESP32_POSTURE'];

/** 디바이스 종류별로 보낼 수 있는 이벤트 타입 제한 */
export const DEVICE_TYPE_EVENTS = {
  ESP32_PIR: ['motion_detected'],
  ESP32_DOOR: ['door_opened'],
  // XIAO ESP32-S3 Sense 자세 인식 데모 — 새 eventType 없이 motion_detected 재사용.
  // 자세는 선택 필드 posture/confidence → events.payload(앱 CareEvent.metadata)로 저장.
  ESP32_POSTURE: ['motion_detected'],
};

/** 선택 필드 posture 허용 값 (no_person 은 펌웨어가 보내지 않는다) */
export const ALLOWED_POSTURES = ['standing', 'sitting', 'lying'];

/** posture/confidence 를 보낼 수 있는 디바이스 종류 */
export const POSTURE_DEVICE_TYPES = ['ESP32_POSTURE'];

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
 * 선택 필드 posture / confidence 는 있을 때만 검증해 결과에 담는다.
 * 둘 다 없으면 결과는 예전과 동일하다 ({ok, deviceId, eventType}).
 * @returns {{ok:true, deviceId:string, eventType:string, posture?:string, confidence?:number} | {ok:false, status:number, error:string}}
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
  const result = { ok: true, deviceId: deviceId.trim(), eventType };

  if (body.posture !== undefined) {
    if (typeof body.posture !== 'string' || !ALLOWED_POSTURES.includes(body.posture)) {
      return fail(400, 'invalid_posture');
    }
    result.posture = body.posture;
  }
  if (body.confidence !== undefined) {
    const c = body.confidence;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
      return fail(400, 'invalid_confidence');
    }
    result.confidence = c;
  }
  return result;
}

/**
 * 2단계: devices 레지스트리 조회 결과 검증.
 * @param device Firestore devices/{deviceId} 문서를 평문 객체로 변환한 것 (없으면 null)
 * @returns {{ok:true} | {ok:false, status:number, error:string}}
 */
export function validateDevice(device, eventType, { hasPosture = false } = {}) {
  if (!device) return fail(404, 'device_not_found');
  if (device.enabled !== true) return fail(403, 'device_disabled');

  if (typeof device.careRecipientId !== 'string' || device.careRecipientId.trim() === '') {
    return fail(422, 'device_missing_careRecipientId');
  }

  // type 누락/null/비문자열 → 거부. (과거엔 type 이 없으면 아래 디바이스별 제한 전체를
  // 건너뛰어, 전역 화이트리스트의 모든 eventType(sos_triggered 포함)이 통과했다.)
  if (typeof device.type !== 'string' || device.type.trim() === '') {
    return fail(422, 'device_missing_type');
  }
  if (!ALLOWED_DEVICE_TYPES.includes(device.type)) {
    return fail(422, 'unsupported_device_type');
  }
  // ALLOWED_DEVICE_TYPES 와 DEVICE_TYPE_EVENTS 가 어긋나도 "제한 없음"으로 통과시키지 않는다.
  const allowed = Object.hasOwn(DEVICE_TYPE_EVENTS, device.type)
    ? DEVICE_TYPE_EVENTS[device.type]
    : undefined;
  if (!allowed || !allowed.includes(eventType)) {
    return fail(422, 'event_type_not_allowed_for_device');
  }
  // posture/confidence 는 자세 인식 기기만 보낼 수 있다 (PIR 등은 기존과 동일 — 보내지 않음).
  if (hasPosture && !POSTURE_DEVICE_TYPES.includes(device.type)) {
    return fail(422, 'posture_not_allowed_for_device');
  }
  return { ok: true };
}

// ── Phase 4.1b: heartbeat 전용 검증 ────────────────────────────────────
//
// heartbeat 는 생활 이벤트가 아니라 "기기 생존 신호" 다. eventType 이 없다.
// ingest 의 validateRequest 의미를 억지로 맞추지 않고 작은 별도 함수를 둔다.

/**
 * heartbeat 요청 검증 (method / X-Device-Key / JSON / deviceId).
 * @returns {{ok:true, deviceId:string} | {ok:false, status:number, error:string}}
 */
export function validateHeartbeatRequest({ method, deviceKeyHeader, body }, { expectedDeviceKey }) {
  if (method !== 'POST') return fail(405, 'method_not_allowed');
  if (!expectedDeviceKey) return fail(500, 'server_misconfigured_no_device_key');
  if (!safeEqual(deviceKeyHeader || '', expectedDeviceKey)) {
    return fail(401, 'invalid_device_key');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'invalid_json_body');
  }
  const { deviceId } = body;
  if (typeof deviceId !== 'string' || deviceId.trim() === '') {
    return fail(400, 'missing_deviceId');
  }
  return { ok: true, deviceId: deviceId.trim() };
}

/**
 * heartbeat 용 device 검증 — 존재 / enabled 만 확인한다.
 * (careRecipientId / type / eventType 제약은 heartbeat 에 해당 없음)
 */
export function validateHeartbeatDevice(device) {
  if (!device) return fail(404, 'device_not_found');
  if (device.enabled !== true) return fail(403, 'device_disabled');
  return { ok: true };
}
