// 이 파일을 secrets.h 로 복사해 값을 채운다. secrets.h 는 .gitignore 에 있다 — 커밋 금지.
//   cp secrets.example.h secrets.h
// DEVICE_ID 는 여기 두지 않는다 — config.h 의 ROOM_DEVICE_IDS 를 BOOT 버튼으로 순환한다.
#pragma once

#define WIFI_SSID      "YOUR_WIFI_SSID"       // 2.4GHz 네트워크
#define WIFI_PASSWORD  "YOUR_WIFI_PASSWORD"
#define DEVICE_KEY     "YOUR_DEVICE_KEY"      // Worker DEVICE_KEY secret 과 동일
#define INGEST_URL     "https://byeolileopji-ingest.byeolileopji.workers.dev/ingest-device-event"
#define HEARTBEAT_URL  "https://byeolileopji-ingest.byeolileopji.workers.dev/device-heartbeat"
