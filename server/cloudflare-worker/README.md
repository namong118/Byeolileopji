# 별일없지 — 디바이스 이벤트 ingest Worker

```
ESP32-S3  →  HTTPS POST /ingest-device-event  →  이 Worker  →  Firestore events
                                                                     ↓ onSnapshot
                                                                별일없지 App
```

> **hosted 검증 완료:** Worker 배포 · `GET /health` · `X-Device-Key` 인증 ·
> `POST /ingest-device-event` → HTTP 201 · `devices/dev-device-livingroom` 조회 ·
> `events` 문서 생성 · Expo 앱 `onSnapshot` 실시간 반영까지 실제 확인됨.
> 남은 것은 실물 ESP32/PIR 하드웨어 E2E (`../../firmware/esp32-pir/README.md`).

## 왜 Cloudflare Workers 인가

- **Firebase Cloud Functions 는 2024년 10월부터 배포에 Blaze(종량제/결제) 플랜이 필요하다.**
  Spark(무료) 플랜에서는 함수 자체를 배포할 수 없다.
- Cloudflare Workers **Free 플랜**: 하루 100,000 요청, HTTPS, `*.workers.dev` 무료 도메인.
  → 결제 등록 없이 PoC 가능.
- 이 Worker 는 **Firebase Admin SDK / service account / private key 를 쓰지 않는다.**
  Phase 2.5 개발용 Firestore 규칙이 `events` create / `devices` read 를 열어두었기 때문에
  Firestore **REST API 를 인증 없이** 호출한다. (**DEVELOPMENT ONLY** — 아래 보안 경고 참고)

## API

### `POST /ingest-device-event`

**Headers**

| 헤더 | 값 |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-Device-Key` | 공유 디바이스 키 (Worker secret `DEVICE_KEY` 와 일치) |

**Body** — ESP32 가 보내는 최소 값

```json
{ "deviceId": "dev-device-livingroom", "eventType": "motion_detected" }
```

`careRecipientId` · `location` · `source` · 시간값은 **서버가 결정한다.** ESP32 는 보내지 않는다.

**처리**

1. `X-Device-Key` 검증 (상수 시간 비교)
2. body / `eventType` 허용값 검증 (앱 `CareEvent.eventType` 과 동일한 소문자 snake_case)
3. Firestore `devices/{deviceId}` 조회 → 존재 / `enabled == true` / `type` / 디바이스별 허용 이벤트 검증
4. Firestore `events` 문서 생성:
   ```
   careRecipientId : devices 문서에서
   deviceId        : 요청값
   eventType       : 요청값
   source          : "sensor"
   location        : devices 문서에서
   payload         : { origin: "esp32", deviceType: "ESP32_PIR" }
   occurredAt      : 서버 시각 (ESP32 시계 무시)
   createdAt       : 서버 시각
   ```

**응답**

| 상태 | 의미 |
| --- | --- |
| `201` | 생성됨 `{ ok:true, eventId, eventType, careRecipientId, location, occurredAt }` |
| `400` | `invalid_json_body` / `missing_deviceId` / `missing_eventType` / `unsupported_eventType` |
| `401` | `invalid_device_key` |
| `403` | `device_disabled` |
| `404` | `device_not_found` |
| `405` | `method_not_allowed` |
| `422` | `unsupported_device_type` / `event_type_not_allowed_for_device` / `device_missing_careRecipientId` |
| `500` | `server_misconfigured_no_device_key` |
| `502` | `firestore_lookup_failed` / `firestore_write_failed` |

### `GET /health`

`{ ok: true, service: "byeolileopji-ingest" }`

## 배포

```bash
cd server/cloudflare-worker
npm install                      # wrangler 설치
npx wrangler login               # 브라우저 인증 (무료 계정)

# DEVICE_KEY 생성 & 등록 (긴 무작위 문자열)
npx wrangler secret put DEVICE_KEY
#  → 프롬프트에 예: $(openssl rand -hex 24) 결과 붙여넣기

# wrangler.toml 의 FIREBASE_PROJECT_ID 확인 (기본 "byeolileopji")
npx wrangler deploy
#  → https://byeolileopji-ingest.<your-subdomain>.workers.dev 게시
```

배포 후 나온 URL 뒤에 `/ingest-device-event` 를 붙인 것이 ESP32 `INGEST_URL`.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars   # DEVICE_KEY 등 채우기
npx wrangler dev                 # http://localhost:8787
```

## 로컬/원격 테스트 (curl / PowerShell)

`<KEY>` 는 등록한 `DEVICE_KEY`, `<URL>` 은 배포 URL(또는 `http://localhost:8787`).

**bash / curl**

```bash
curl -i -X POST "<URL>/ingest-device-event" \
  -H "Content-Type: application/json" \
  -H "X-Device-Key: <KEY>" \
  -d '{"deviceId":"dev-device-livingroom","eventType":"motion_detected"}'
```

**Windows PowerShell**

```powershell
$body = '{"deviceId":"dev-device-livingroom","eventType":"motion_detected"}'
Invoke-RestMethod -Method Post -Uri "<URL>/ingest-device-event" `
  -ContentType "application/json" `
  -Headers @{ "X-Device-Key" = "<KEY>" } `
  -Body $body
```

또는 PowerShell 에서 `curl.exe` (別칭 아님):

```powershell
curl.exe -i -X POST "<URL>/ingest-device-event" `
  -H "Content-Type: application/json" `
  -H "X-Device-Key: <KEY>" `
  -d '{\"deviceId\":\"dev-device-livingroom\",\"eventType\":\"motion_detected\"}'
```

성공하면 `201` + `eventId`, 그리고 **별일없지 앱의 홈/타임라인에 몇 초 내 자동으로**
"거실에서 활동이 확인됐어요." 가 나타난다 (앱이 Firebase 에 연결된 상태여야 함).

## ⚠️ 보안 경고 — DEVELOPMENT / POC, NOT PRODUCTION READY

- 이 Worker 는 Firestore 를 **인증 없이** 쓴다 (개발용 규칙에 의존).
- 디바이스 인증은 **공유 키 1개**(`X-Device-Key`)뿐이다.
  per-device key, 키 회전, replay 방지, rate limiting **없음**.
- `devices` 컬렉션은 앱에서 read 가능(개발용 규칙)하므로 **평문 secret 을 devices 문서에
  저장하지 않는다.** `DEVICE_KEY` 는 Worker secret 에만 둔다.
- Phase 4 계획:
  - Firestore 규칙을 `events` write 금지(서버만)로 좁힌다.
  - Worker 가 **service account 로 OAuth2 access token** 을 발급(JWT 서명)해
    `Authorization: Bearer` 로 Firestore 에 쓴다. (`firestore.js` 상단 주석 참고)
  - per-device key + 서명 검증 + rate limiting.
