/**
 * 별일없지 — 디바이스 이벤트 ingest Worker (Cloudflare Workers, Free plan).
 *
 *   ESP32-S3  →  HTTPS POST /ingest-device-event  →  이 Worker  →  Firestore events
 *                                                                       ↓ onSnapshot
 *                                                                  별일없지 App
 *
 * ⚠️ DEVELOPMENT / POC — NOT PRODUCTION READY (server/cloudflare-worker/README.md 참고)
 */

import { validateRequest, validateDevice } from './validate.js';
import { buildEventDoc } from './buildEvent.js';
import { getDevice, createEvent, FirestoreError } from './firestore.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
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

    if (url.pathname !== '/ingest-device-event') {
      return json({ ok: false, error: 'not_found' }, 404);
    }

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
      log(`reject ${v.status} ${v.error}`);
      return json({ ok: false, error: v.error }, v.status);
    }

    // 3) devices 레지스트리 조회
    let device;
    try {
      device = await getDevice(env, v.deviceId);
    } catch (err) {
      log(`firestore lookup failed: ${err}`);
      return json({ ok: false, error: 'firestore_lookup_failed' }, 502);
    }

    // 4) 디바이스 검증 (존재 / enabled / type / eventType 허용)
    const dv = validateDevice(device, v.eventType);
    if (!dv.ok) {
      log(`reject ${dv.status} ${dv.error} (device=${v.deviceId})`);
      return json({ ok: false, error: dv.error }, dv.status);
    }

    // 5) events 문서 생성 (occurredAt / createdAt = 서버 시각)
    const eventDoc = buildEventDoc({ deviceId: v.deviceId, eventType: v.eventType, device });
    let eventId;
    try {
      eventId = await createEvent(env, eventDoc);
    } catch (err) {
      const status = err instanceof FirestoreError ? 502 : 500;
      log(`firestore write failed: ${err}`);
      return json({ ok: false, error: 'firestore_write_failed' }, status);
    }

    log(`created event ${eventId} (${v.eventType} @ ${eventDoc.location ?? '-'})`);
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
  },
};

function log(msg) {
  // Cloudflare 대시보드 > Workers > Logs 에서 확인
  console.log(`[ingest] ${msg}`);
}
