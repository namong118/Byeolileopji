# 별일없지 — ESP32-S3 PIR 펌웨어

```
사람 움직임 → HC-SR501 PIR → ESP32-S3 → Wi-Fi → HTTPS POST /ingest-device-event
  → Firestore events → onSnapshot → 별일없지 앱 → "거실에서 활동이 확인됐어요."     (사람 활동 신호)

주기적 heartbeat → ESP32-S3 → Wi-Fi → HTTPS POST /device-heartbeat
  → devices/{id}.lastHeartbeatAt → 앱 deriveDeviceHealth() → online/offline    (기기 생존 신호, Phase 4.1b)
```

## 검증 상태

| 구간 | 상태 |
| --- | --- |
| ESP32-S3 DevKitC-1 실기기 인식 + 펌웨어 업로드 | ✅ 실기기 검증 완료 |
| ESP32-S3 → 2.4GHz Wi-Fi 연결 | ✅ 실기기 검증 완료 |
| ESP32-S3 → Cloudflare Worker HTTPS POST + `X-Device-Key` 인증 → HTTP 201 | ✅ 실기기 검증 완료 |
| Worker → Firestore `events` 생성 + `devices.lastEventAt` 갱신 → 앱 실시간 반영 | ✅ 실기기 검증 완료 (Phase 4.1a) |
| **heartbeat (`sendHeartbeat`/`handleHeartbeat`, Phase 4.1b)** | ✅ **실기기 업로드 + `[HB] 200` 확인 · `devices.lastHeartbeatAt` 갱신 · 앱 `online`/`heartbeat_fresh` 확인** |
| **heartbeat online → 전원 차단 → offline → 재연결 → online 왕복 (Phase 4.1b)** | ✅ **실기기 검증 완료** (테스트값 heartbeat 30초 / offline 2분 / recompute 15초 — 원복함) |
| 사람 움직임 → HC-SR501 PIR → GPIO4 → ESP32-S3 | ⏳ **pending** (PIR 센서/브레드보드 미연결. USB 분리/재연결 중 관측된 floating `motion_detected` 는 PIR E2E 성공으로 기록 안 함) |

> 네트워크 E2E 는 현재 `esp32-pir.ino` 의 `setup()` 에 있는 **TEMP TEST 블록**
> (`[TEST]` 로그, 부팅당 `motion_detected` 1회 전송) 으로 검증했다.
> **PIR 센서가 도착하면 이 블록을 제거**하고, 배선(VCC-5V / GND-GND / OUT-GPIO4) 후
> 실제 상승 에지 → `handlePir()` 경로로 재검증한다. (Phase 4.1b 작업에서 TEMP TEST 는
> 건드리지 않았다.)

## 하드웨어

| 부품 | 비고 |
| --- | --- |
| ESP32-S3 DevKitC-1 (N16R8 등) | USB-C **데이터** 케이블 필요 (충전 전용 X) |
| HC-SR501 PIR 모션센서 | 전원 인가 후 약 60초 워밍업 |
| 2.4GHz Wi-Fi | ESP32 는 5GHz 미지원 |
| 점퍼선 3개 | |

## 배선

| HC-SR501 | ESP32-S3 DevKitC-1 |
| --- | --- |
| `VCC` | `5V`  (USB 5V. HC-SR501 은 온보드 레귤레이터가 있어 4.5~20V 입력 허용) |
| `GND` | `GND` |
| `OUT` | `GPIO4`  (`config.h` 의 `PIR_PIN`) |

- HC-SR501 `OUT` 은 감지 시 약 **3.3V** 로짜 HIGH 를 출력한다 → ESP32-S3 3.3V 입력에 그대로 연결 가능.
  (일부 클론이 5V 로짜를 낸다면 분압 저항 필요. 일반 HC-SR501 은 3.3V.)
- **피해야 할 GPIO**: 0 / 3 / 45 / 46 (스트래핑), 19 / 20 (USB-JTAG),
  26~32 (SPI 플래시), 33~37 (N16R8 옥탈 PSRAM), 43 / 44 (UART0 = Serial).
- `PIR_PIN` 대안: **5, 6, 7, 15, 16, 17, 18**.
- HC-SR501 트리머 2개: `Sx`(감도, 시계방향 = 민감), `Tx`(HIGH 유지 시간, 반시계 = 최소 ~3초).
  점퍼 `H` = repeat trigger(권장), `L` = single trigger.

## Arduino IDE 설정

1. **Boards Manager** 에 ESP32 추가:
   `File > Preferences > Additional boards manager URLs` 에
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   → `Tools > Board > Boards Manager` 에서 **esp32 by Espressif** 설치 (3.x)
2. `Tools > Board` → **ESP32S3 Dev Module**
3. `Tools` 설정:
   - USB CDC On Boot: **Enabled**  (Serial Monitor 출력에 필요)
   - Flash Size: **16MB**,  PSRAM: **OPI PSRAM** (N16R8 기준)
   - Upload Mode: **UART0 / Hardware CDC**
   - Port: 보드 연결 후 나타나는 COM 포트
4. 라이브러리 설치 **불필요** (WiFi / WiFiClientSecure / HTTPClient 는 core 기본)

## 펌웨어 업로드

```
firmware/esp32-pir/
  esp32-pir.ino     ← Arduino IDE 로 이 파일 열기
  config.h
  secrets.example.h → 복사해서 secrets.h 생성
  secrets.h         ← 실제 값 (git 무시됨)
```

1. `secrets.example.h` 를 같은 폴더에 `secrets.h` 로 복사 (이미 있다면 유지)
2. `secrets.h` 채우기 (Phase 4.1b 에서 **새로 추가된 항목**: `HEARTBEAT_URL`):
   - `WIFI_SSID` / `WIFI_PASSWORD`
   - `DEVICE_ID` = `dev-device-livingroom` (Firestore `devices` 문서 ID 와 동일)
   - `DEVICE_KEY` = Cloudflare Worker 에 등록한 값과 동일 (ingest 와 heartbeat 공용, 새 키 아님)
   - `INGEST_URL` = `https://<worker>.workers.dev/ingest-device-event`
   - **`HEARTBEAT_URL` = `https://<worker>.workers.dev/device-heartbeat`** ← Phase 4.1b 신규
3. Arduino IDE 에서 `esp32-pir.ino` 열기 → 업로드 (→)
4. `Tools > Serial Monitor`, **115200 baud**

## Serial 로그 예시

```
[별일없지] ESP32-S3 PIR firmware
[cfg] device=dev-device-livingroom pin=4 cooldown=5000ms
[WiFi] connecting to "..." ...
[WiFi] connected, ip=192.168.0.42
[PIR] warming up 60s ...
[PIR] warmup done, sensing active
[PIR] motion detected
[HTTP] POST /ingest-device-event (attempt 1/3)
[HTTP] 201 {"ok":true,"eventId":"...","eventType":"motion_detected",...}
[Event] sent successfully
```

heartbeat 로그 (Phase 4.1b):

```
[HB] POST /device-heartbeat (attempt 1/2)
[HB] 200 {"ok":true,"deviceId":"dev-device-livingroom","lastHeartbeatAt":"..."}
```

실패 예:

```
[HTTP] failed: 401              → DEVICE_KEY 불일치
[HTTP] failed: 404              → devices/{DEVICE_ID} 문서 없음
[HTTP] failed: 403              → devices 문서 enabled != true
[HTTP] transport error: ...     → Wi-Fi / DNS / URL 문제
[HB]   failed: 502              → Firestore rules 미게시(devices update 거부) 가능성 높음
```

## 동작 요약

- **워밍업**: 부팅 후 `PIR_WARMUP_MS`(기본 60s) 동안 감지 무시.
- **상승 에지**: `LOW → HIGH` 전환 순간에만 이벤트 1회. HIGH 유지/연속 트리거는 무시.
- **쿨다운**: 이벤트 전송 후 `MOTION_COOLDOWN_MS`(개발 5s / 실사용 30s+) 동안 추가 이벤트 무시.
- **재시도**: POST 실패 시 최대 3회(2s 간격). 401/403/404 는 설정 오류로 보고 즉시 중단.
- **Wi-Fi 재연결**: 끊기면 `WIFI_RETRY_INTERVAL_MS`(5s) 간격으로 재시도. 무한 busy-loop 없음.
- **시간**: `occurredAt` / `createdAt` 은 **서버(Worker)가 생성**. ESP32 시계가 틀려도 타임라인이 안 깨진다.
- **heartbeat (Phase 4.1b)**: 부팅 시 1회 + `HEARTBEAT_INTERVAL_MS`(기본 10분)마다 + Wi-Fi 재연결 시
  즉시. `events` 문서는 만들지 않고 `devices.lastHeartbeatAt` 만 갱신. 실패해도 무한 재시도 안 함
  (최대 2회, 다음 주기가 커버). `handlePir()`/`postEvent()`/워밍업/쿨다운/TEMP TEST 는 무변경.

## 하드웨어 없이 먼저 테스트

`esp32-pir.ino` 를 굽기 전에, Worker 만 배포하면 curl/PowerShell 로 전체 파이프라인
(ingest·heartbeat 둘 다)을 검증할 수 있다 → `server/cloudflare-worker/README.md` 참고.

## 개발 테스트용 빠른 시간 설정 (Phase 4.1b)

실사용 기본값(heartbeat 10분 / offline 임계 25분)을 매번 기다리면 느리다. 검증할 때만:

1. `config.h` 의 `HEARTBEAT_INTERVAL_MS` 를 `30000UL`(30초) 로 **로컬에서만** 수정
2. 앱 `.env` 에 `EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES=2` 추가 후 `npm start -c`
3. 검증이 끝나면 **두 값 모두 원래대로 되돌리고 `.env` 는 커밋하지 않는다**
   (`.env` 는 이미 `.gitignore` 처리돼 있음)

## 실기기 검증 순서 (Phase 4.1b) — ✅ 완료

아래 절차대로 **실물 ESP32-S3 로 검증 완료**했다 (사용자).

1. ✅ Firebase Console 에 `firestore.rules` 재게시 (`lastEventAt`+`lastHeartbeatAt` 허용)
2. ✅ Cloudflare `npx wrangler deploy` (새 secret 불필요, 기존 `DEVICE_KEY` 그대로)
3. ✅ `secrets.h` 에 `HEARTBEAT_URL` 한 줄 추가 (사용자 직접, git 무시됨)
4. ✅ `esp32-pir.ino` 업로드 → Serial Monitor 에서 **`[HB] 200 ...` 확인**
5. ✅ Firebase Console `devices/dev-device-livingroom.lastHeartbeatAt` **갱신 확인**
6. ✅ 별일없지 앱 개발자 탭 > Device Health: **`derived health = online / heartbeat_fresh` 확인**
7. ✅ ESP32-S3 USB 전원 분리 → offline 임계(테스트값 2분) 경과 → 앱 **`offline` / `heartbeat_stale`**,
   홈 Hero **"센서 연결을 확인하고 있어요"** 로 전환 확인
8. ✅ USB 재연결 → heartbeat 재개 → **`online` / `heartbeat_fresh` 자동 복귀 확인**
   → `ONLINE → 전원 차단 → OFFLINE → 재연결 → ONLINE` 왕복 E2E 검증 완료
9. ✅ 그 사이 사람 축(`NORMAL`/`CHECK`)이 기기 축과 별개로 계산됨을 확인
   (`CHECK ≠ 센서 offline`, 기기 offline 이 사람 축 문구를 오염시키지 않음)

> 검증에 쓴 임시값(`HEARTBEAT_INTERVAL_MS` 30초 / `EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES` 2분 /
> `EXPO_PUBLIC_STATUS_RECOMPUTE_INTERVAL_MS` 15초)은 **모두 원복**했다. 코드 기본값은
> heartbeat 10분 / offline 25분 그대로다.

**아직 pending:** HC-SR501 PIR 실물 센서 → GPIO4 → `handlePir()` 경로. PIR 미연결 상태에서
관측된 `motion_detected` 는 GPIO4 floating 가능성이 있어 PIR E2E 성공으로 기록하지 않는다.
`esp32-pir.ino` 의 TEMP TEST 블록도 PIR 실물 검증 때까지 유지한다.

## ⚠️ 보안 (DEVELOPMENT / POC)

- HTTPS 인증서 검증을 생략한다 (`client.setInsecure()`). Phase 4 에서 CA 핀 고정.
- 디바이스 인증은 공유 키 1개. per-device key / 회전 / replay 방지 없음.
  heartbeat 도 같은 `DEVICE_KEY` 를 재사용한다 (별도 키 아님).
- `secrets.h` 는 절대 커밋하지 않는다 (`.gitignore` 처리됨).
