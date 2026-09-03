# 별일없지 — ESP32-S3 PIR 펌웨어

```
사람 움직임 → HC-SR501 PIR → ESP32-S3 → Wi-Fi → HTTPS POST
  → Cloudflare Worker(/ingest-device-event) → Firestore events
  → onSnapshot → 별일없지 앱 → "거실에서 활동이 확인됐어요."
```

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

1. `secrets.example.h` 를 같은 폴더에 `secrets.h` 로 복사
2. `secrets.h` 채우기:
   - `WIFI_SSID` / `WIFI_PASSWORD`
   - `DEVICE_ID` = `dev-device-livingroom` (Firestore `devices` 문서 ID 와 동일)
   - `DEVICE_KEY` = Cloudflare Worker 에 등록한 값과 동일
   - `INGEST_URL` = `https://<worker>.workers.dev/ingest-device-event`
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

실패 예:

```
[HTTP] failed: 401              → DEVICE_KEY 불일치
[HTTP] failed: 404              → devices/{DEVICE_ID} 문서 없음
[HTTP] failed: 403              → devices 문서 enabled != true
[HTTP] transport error: ...     → Wi-Fi / DNS / URL 문제
```

## 동작 요약

- **워밍업**: 부팅 후 `PIR_WARMUP_MS`(기본 60s) 동안 감지 무시.
- **상승 에지**: `LOW → HIGH` 전환 순간에만 이벤트 1회. HIGH 유지/연속 트리거는 무시.
- **쿨다운**: 이벤트 전송 후 `MOTION_COOLDOWN_MS`(개발 5s / 실사용 30s+) 동안 추가 이벤트 무시.
- **재시도**: POST 실패 시 최대 3회(2s 간격). 401/403/404 는 설정 오류로 보고 즉시 중단.
- **Wi-Fi 재연결**: 끊기면 `WIFI_RETRY_INTERVAL_MS`(5s) 간격으로 재시도. 무한 busy-loop 없음.
- **시간**: `occurredAt` / `createdAt` 은 **서버(Worker)가 생성**. ESP32 시계가 틀려도 타임라인이 안 깨진다.

## 하드웨어 없이 먼저 테스트

`esp32-pir.ino` 를 굽기 전에, Worker 만 배포하면 curl/PowerShell 로 전체 파이프라인을
검증할 수 있다 → `server/cloudflare-worker/README.md` 참고.

## ⚠️ 보안 (DEVELOPMENT / POC)

- HTTPS 인증서 검증을 생략한다 (`client.setInsecure()`). Phase 4 에서 CA 핀 고정.
- 디바이스 인증은 공유 키 1개. per-device key / 회전 / replay 방지 없음.
- `secrets.h` 는 절대 커밋하지 않는다 (`.gitignore` 처리됨).
