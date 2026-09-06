// 별일없지 ESP32-S3 PIR 펌웨어 — 비밀 값 템플릿.
//
//   이 파일을 복사해 secrets.h 를 만들고 실제 값을 채운다.
//   secrets.h 는 .gitignore 처리됨 — 절대 커밋하지 않는다.
//
//   Arduino IDE:  이 폴더의 esp32-pir.ino 를 열면 같은 폴더의 secrets.h 를 자동 포함.

#pragma once

#define WIFI_SSID      "YOUR_WIFI_SSID"       // 2.4GHz 네트워크 (ESP32 는 5GHz 미지원)
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"

// Firestore devices/{DEVICE_ID} 문서 ID 와 동일해야 한다.
#define DEVICE_ID      "dev-device-livingroom"

// Cloudflare Worker 에 등록한 DEVICE_KEY 와 동일해야 한다.
#define DEVICE_KEY     "YOUR_DEVICE_KEY"

// 배포된 Worker URL + 경로.
#define INGEST_URL     "https://byeolileopji-ingest.byeolileopji.workers.dev/ingest-device-event"

// Phase 4.1b — heartbeat endpoint. 같은 Worker, 경로만 다름.
#define HEARTBEAT_URL  "https://byeolileopji-ingest.byeolileopji.workers.dev/device-heartbeat"
