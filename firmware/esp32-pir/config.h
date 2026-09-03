// 별일없지 ESP32-S3 PIR 펌웨어 — 비밀이 아닌 설정값 (커밋됨)
// 실제 Wi-Fi / 키 / URL 은 secrets.h 에 (secrets.example.h 참고)

#pragma once

// ── GPIO ────────────────────────────────────────────────────────────────
// ESP32-S3 DevKitC-1 에서 안전한 일반 입력 핀.
// 피해야 할 핀: 0(스트래핑), 3/45/46(스트래핑), 19/20(USB-JTAG),
//              26~32(SPI 플래시), 33~37(N16R8 옥탈 PSRAM), 43/44(UART0 = Serial).
// 대안으로 쓸 수 있는 핀: 5, 6, 7, 15, 16, 17, 18.
#define PIR_PIN 4

// ── PIR 이벤트 폭주 방지 ────────────────────────────────────────────────
// HIGH 가 유지되는 동안, 또는 연속 트리거되는 동안 이벤트가 폭주하지 않도록
// LOW→HIGH 상승 에지 1회만 이벤트로 보내고, 쿨다운 동안은 무시한다.
#define MOTION_COOLDOWN_MS   5000UL    // 개발용. 실사용 PoC 는 30000UL 이상 권장.

// HC-SR501 은 전원 인가 후 워밍업(안정화) 시간이 필요하다. 이 시간 동안은 무시.
#define PIR_WARMUP_MS        60000UL

// ── Wi-Fi ───────────────────────────────────────────────────────────────
#define WIFI_CONNECT_TIMEOUT_MS   20000UL   // 최초 연결 대기 한도
#define WIFI_RETRY_INTERVAL_MS     5000UL   // 끊겼을 때 재시도 간격 (busy-loop 금지)

// ── HTTPS POST ──────────────────────────────────────────────────────────
#define HTTP_TIMEOUT_MS      10000UL
#define HTTP_MAX_RETRIES     3          // 즉시 무한 재시도 금지
#define HTTP_RETRY_DELAY_MS  2000UL

// ── 로그 ────────────────────────────────────────────────────────────────
#define SERIAL_BAUD 115200
