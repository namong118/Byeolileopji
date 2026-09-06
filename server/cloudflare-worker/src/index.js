/**
 * 별일없지 — 디바이스 Worker (Cloudflare Workers, Free plan).
 *
 *   ESP32-S3  →  POST /ingest-device-event   →  Firestore events  (사람 활동 신호)
 *             →  POST /device-heartbeat       →  devices/{id}.lastHeartbeatAt  (기기 생존 신호)
 *                                                     ↓ onSnapshot
 *                                                별일없지 App
 *
 * ⚠️ DEVELOPMENT / POC — NOT PRODUCTION READY (server/cloudflare-worker/README.md 참고)
 */

import {
  validateRequest,
  validateDevice,
  validateHeartbeatRequest,
  validateHeartbeatDevice,
} from './validate.js';
import { buildEventDoc } from './buildEvent.js';
import { getDevice, createEvent, touchDevice, FirestoreError } from './firestore.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function log(msg) {
  // Cloudflare 대시보드 > Workers > Logs 에서 확인
  console.log(`[worker] ${msg}`);
}

export default {
  /**
   * @param {Request} request
   * @param {{ FIREBASE_PROJECT_ID?: string, FIREBASE_API_KEY?: string, DEVICE_KEY?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, service: 'byeolileopji-ingest', endpoint: '/ingest-device-event' });
    }

    if (url.pathname === '/ingest-device-event') {
      return handleIngest(request, env);
    }
    if (url.pathname === '/device-heartbeat') {
      return handleHeartbeat(request, env);
    }

    return json({ ok: false, error: 'not_found' }, 404);
  },
};

// ── POST /ingest-device-event — 생활 이벤트 (Phase 3, 변경 없음) ────────
async function handleIngest(request, env) {
  // 1) body 파싱
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // 2) 요청 검증 (method / X-Device-Key / JSON / eventType)
  const v = validateRequest(
    {
      method: request.method,
      deviceKeyHeader: request.headers.get('x-device-key'),
      body,
    },
    { expectedDeviceKey: env.DEVICE_KEY },
  );
  if (!v.ok) {
    log(`ingest reject ${v.status} ${v.error}`);
    return json({ ok: false, error: v.error }, v.status);
  }

  // 3) devices 레지스트리 조회
  let device;
  try {
    device = await getDevice(env, v.deviceId);
  } catch (err) {
    log(`ingest firestore lookup failed: ${err}`);
    return json({ ok: false, error: 'firestore_lookup_failed' }, 502);
  }

  // 4) 디바이스 검증 (존재 / enabled / type / eventType 허용)
  const dv = validateDevice(device, v.eventType);
  if (!dv.ok) {
    log(`ingest reject ${dv.status} ${dv.error} (device=${v.deviceId})`);
    return json({ ok: false, error: dv.error }, dv.status);
  }

  // 5) events 문서 생성 (occurredAt / createdAt = 서버 시각) — primary operation
  const eventDoc = buildEventDoc({ deviceId: v.deviceId, eventType: v.eventType, device });
  let eventId;
  try {
    eventId = await createEvent(env, eventDoc);
  } catch (err) {
    const status = err instanceof FirestoreError ? 502 : 500;
    log(`ingest firestore write failed: ${err}`);
    return json({ ok: false, error: 'firestore_write_failed' }, status);
  }

  // 6) devices/{id}.lastEventAt 갱신 — best-effort (Phase 4.1a)
  //    이미 성공한 ingest 를 이 실패 때문에 실패로 만들지 않는다. 201 유지.
  try {
    await touchDevice(env, v.deviceId, { lastEventAt: eventDoc.occurredAt });
  } catch (err) {
    log(`ingest touchDevice(lastEventAt) failed (non-fatal): ${err}`);
  }

  log(`ingest created event ${eventId} (${v.eventType} @ ${eventDoc.location ?? '-'})`);
  return json(
    {
      ok: true,
      eventId,
      eventType: v.eventType,
      careRecipientId: device.careRecipientId,
      location: eventDoc.location,
      occurredAt: eventDoc.occurredAt.toISOString(),
    },
    201,
  );
}

// ── POST /device-heartbeat — 기기 생존 신호 (Phase 4.1b) ───────────────
//
// events 문서를 생성하지 않는다. devices/{id}.lastHeartbeatAt 만 갱신한다.
// 이 갱신이 endpoint 의 목적이므로, write 실패 시 5xx 를 반환한다 (best-effort 아님).
async function handleHeartbeat(request, env) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  // 1) 요청 검증 (method / X-Device-Key / JSON / deviceId)
  const v = validateHeartbeatRequest(
    {
      method: request.method,
      deviceKeyHeader: request.headers.get('x-device-key'),
      body,
    },
    { expectedDeviceKey: env.DEVICE_KEY },
  );
  if (!v.ok) {
    log(`heartbeat reject ${v.status} ${v.error}`);
    return json({ ok: false, error: v.error }, v.status);
  }

  // 2) devices 레지스트리 조회
  let device;
  try {
    device = await getDevice(env, v.deviceId);
  } catch (err) {
    log(`heartbeat firestore lookup failed: ${err}`);
    return json({ ok: false, error: 'firestore_lookup_failed' }, 502);
  }

  // 3) 디바이스 검증 (존재 / enabled)
  const dv = validateHeartbeatDevice(device);
  if (!dv.ok) {
    log(`heartbeat reject ${dv.status} ${dv.error} (device=${v.deviceId})`);
    return json({ ok: false, error: dv.error }, dv.status);
  }

  // 4) devices/{id}.lastHeartbeatAt = 서버 시각. 실패 시 5xx.
  const now = new Date();
  try {
    await touchDevice(env, v.deviceId, { lastHeartbeatAt: now });
  } catch (err) {
    const status = err instanceof FirestoreError ? 502 : 500;
    log(`heartbeat firestore write failed: ${err}`);
    return json({ ok: false, error: 'firestore_write_failed' }, status);
  }

  log(`heartbeat ${v.deviceId} @ ${now.toISOString()}`);
  return json(
    { ok: true, deviceId: v.deviceId, lastHeartbeatAt: now.toISOString() },
    200,
  );
}
