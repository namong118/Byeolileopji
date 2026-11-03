// 별일없지 — XIAO ESP32-S3 Sense 자세 인식 데모 설정 (비밀 아님)
#pragma once

// ── 데모 방 (devices 레지스트리: scripts/register-xiao-demo-devices.mjs) ──
// XIAO 1대로 BOOT 버튼을 눌러 보내는 DEVICE_ID 를 순환한다.
// 방 이름(location)은 서버가 devices 문서에서 채운다 — 여기 이름은 시리얼 출력용.
#define ROOM_COUNT 3
static const char *const ROOM_DEVICE_IDS[ROOM_COUNT] = {"xiao-living", "xiao-kitchen", "xiao-bed"};
static const char *const ROOM_NAMES[ROOM_COUNT] = {"거실", "부엌", "침대"};

// ── 자세 투표 (posture_vote.h) ──
// 시리얼 "[EI] NNNms" 실측이 1초를 넘으면 5프레임 확정에 5초 이상 걸린다 → 3 으로 낮춘다.
#define VOTE_FRAMES      5      // 최근 N프레임 다수결 (추론 >1000ms 면 3)
#define MIN_CONFIDENCE   0.6f   // 이 미만 프레임은 투표에서 제외

// ── 판단 근거 스냅샷 (데모 전용, 기본 꺼짐) ──
// true 면 자세 확정·전송 시점의 프레임(JPEG) 1장을 RAM 에만 보관하고
// 로컬 네트워크 http://<XIAO IP>:81/snapshot 으로 제공한다 (최신 1장, 스트리밍 아님).
// 이벤트 POST 에 snapshotSeq(증가 번호)를 넣는다. 사진은 서버로 전송·저장하지 않는다.
#define DEMO_SNAPSHOT        false
#define SNAPSHOT_PORT        81
#define SNAPSHOT_MAX_BYTES   (64 * 1024)   // QVGA JPEG 1장 상한 (넘으면 보관 안 함)

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
