// 별일없지 — XIAO ESP32-S3 Sense 자세 인식 데모 설정 (비밀 아님)
#pragma once

// ── 데모 방 (devices 레지스트리: scripts/register-xiao-demo-devices.mjs) ──
// XIAO 1대로 BOOT 버튼을 눌러 보내는 DEVICE_ID 를 순환한다.
// 방 이름(location)은 서버가 devices 문서에서 채운다 — 여기 이름은 시리얼 출력용.
#define ROOM_COUNT 3
static const char *const ROOM_DEVICE_IDS[ROOM_COUNT] = {"xiao-living", "xiao-kitchen", "xiao-bed"};
static const char *const ROOM_NAMES[ROOM_COUNT] = {"거실", "부엌", "침대"};

// ── 자세 투표 (posture_vote.h) ──
#define VOTE_FRAMES      5      // 최근 N프레임 다수결
#define MIN_CONFIDENCE   0.6f   // 이 미만 프레임은 투표에서 제외

// ── 루프 ──
#define INFERENCE_INTERVAL_MS  200UL   // 프레임 캡처·추론 간격
#define BOOT_BUTTON_PIN        0       // XIAO ESP32-S3 BOOT 버튼 (GPIO0, 누르면 LOW)
#define BUTTON_DEBOUNCE_MS     50UL

// ── 네트워크 (esp32-pir 와 동일 값) ──
#define WIFI_CONNECT_TIMEOUT_MS   20000UL
#define WIFI_RETRY_INTERVAL_MS     5000UL
#define HTTP_TIMEOUT_MS           10000UL
#define HTTP_MAX_RETRIES          3
#define HTTP_RETRY_DELAY_MS       2000UL
#define HEARTBEAT_INTERVAL_MS     600000UL   // 10분
#define HEARTBEAT_MAX_RETRIES     2
#define HEARTBEAT_RETRY_DELAY_MS  1500UL

#define SERIAL_BAUD 115200
