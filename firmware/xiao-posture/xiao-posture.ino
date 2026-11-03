/*
 * 별일없지 — XIAO ESP32-S3 Sense 자세 인식 센서 데모 (뼈대, 실기기 미검증)
 *
 *   카메라 프레임 → Edge Impulse 분류(MobileNetV2 96x96: standing/sitting/lying/no_person)
 *     → 최근 VOTE_FRAMES 다수결(posture_vote.h) → 자세가 바뀔 때만
 *     POST /ingest-device-event { deviceId, eventType:"motion_detected", posture, confidence }
 *   주기적 heartbeat → POST /device-heartbeat (esp32-pir 와 같은 방식)
 *
 *   BOOT 버튼(GPIO0): 다음 방(DEVICE_ID)으로 순환 + 투표 버퍼 초기화 + 시리얼에 현재 방 출력.
 *   원본 영상은 저장·전송하지 않는다 (분류 결과만 전송).
 *
 * 보드: XIAO_ESP32S3, PSRAM: OPI PSRAM (Arduino IDE > Tools)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "img_converters.h"

// TODO(EI): Edge Impulse 에서 내보낸 Arduino 라이브러리의 헤더 이름으로 교체한다.
//           (예: <별일없지_posture_inferencing.h> — 라이브러리 zip 안 src/ 의 *_inferencing.h)
#include <xiao_posture_inferencing.h>
#include "edge-impulse-sdk/dsp/image/image.hpp"

#include "config.h"
#include "secrets.h"
#include "posture_vote.h"

// ── XIAO ESP32-S3 Sense 카메라 핀 (OV2640, Seeed 공식 핀맵) ─────────────
#define PWDN_GPIO_NUM   -1
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM   10
#define SIOD_GPIO_NUM   40
#define SIOC_GPIO_NUM   39
#define Y9_GPIO_NUM     48
#define Y8_GPIO_NUM     11
#define Y7_GPIO_NUM     12
#define Y6_GPIO_NUM     14
#define Y5_GPIO_NUM     16
#define Y4_GPIO_NUM     18
#define Y3_GPIO_NUM     17
#define Y2_GPIO_NUM     15
#define VSYNC_GPIO_NUM  38
#define HREF_GPIO_NUM   47
#define PCLK_GPIO_NUM   13

// 캡처 해상도 (QVGA 320x240 JPEG → RGB888 → 모델 입력 크기로 crop+resize)
#define CAPTURE_WIDTH   320
#define CAPTURE_HEIGHT  240

// ── 상태 ────────────────────────────────────────────────────────────────
static int           roomIndex          = 0;
static PostureVoter  voter;
static uint8_t      *rgbBuf             = nullptr;   // CAPTURE_WIDTH*CAPTURE_HEIGHT*3 (PSRAM)
static unsigned long lastInferenceMs    = 0;
static unsigned long lastWifiAttemptMs  = 0;
// heartbeat (esp32-pir 와 동일)
static unsigned long lastHeartbeatMs    = 0;
static bool          heartbeatPending   = true;
static bool          wasWifiConnected   = false;
// BOOT 버튼
static int           lastButtonLevel    = HIGH;
static unsigned long lastButtonChangeMs = 0;

static const char *currentDeviceId() { return ROOM_DEVICE_IDS[roomIndex]; }

// ── Wi-Fi (esp32-pir 와 동일) ───────────────────────────────────────────
void wifiConnect() {
  if (WiFi.status() == WL_CONNECTED) return;
  unsigned long now = millis();
  if (now - lastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS && lastWifiAttemptMs != 0) return;
  lastWifiAttemptMs = now;

  Serial.printf("[WiFi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] connected, ip=");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] connect failed, will retry");
  }
}

// ── HTTPS POST (재시도 규칙은 esp32-pir 와 동일) ─────────────────────────
int postJson(const char *url, const String &body, int maxRetries, unsigned long retryDelayMs,
             const char *tag) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("[%s] skip: WiFi not connected\n", tag);
    return -1;
  }
  WiFiClientSecure client;
  client.setInsecure();  // PoC: 인증서 검증 생략 (esp32-pir 와 동일)

  int lastCode = -1;
  for (int attempt = 1; attempt <= maxRetries; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    if (!http.begin(client, url)) {
      Serial.printf("[%s] begin() failed\n", tag);
      lastCode = -1;
    } else {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Key", DEVICE_KEY);
      Serial.printf("[%s] POST (attempt %d/%d)\n", tag, attempt, maxRetries);
      lastCode = http.POST(body);
      if (lastCode > 0) {
        Serial.printf("[%s] %d %s\n", tag, lastCode, http.getString().c_str());
      } else {
        Serial.printf("[%s] transport error: %s\n", tag, http.errorToString(lastCode).c_str());
      }
      http.end();
    }
    if (lastCode >= 200 && lastCode < 300) return lastCode;
    if (lastCode == 400 || lastCode == 401 || lastCode == 403 || lastCode == 404 || lastCode == 422) {
      Serial.printf("[%s] failed: %d (config/validation error, not retrying)\n", tag, lastCode);
      return lastCode;
    }
    if (attempt < maxRetries) delay(retryDelayMs);
  }
  Serial.printf("[%s] giving up\n", tag);
  return lastCode;
}

int postPosture(Posture p, float confidence) {
  const char *name = posture_api_name(p);
  if (!name) return -1;  // no_person / unknown 은 전송하지 않는다
  String body = String("{\"deviceId\":\"") + currentDeviceId() +
                "\",\"eventType\":\"motion_detected\",\"posture\":\"" + name +
                "\",\"confidence\":" + String(confidence, 3) + "}";
  return postJson(INGEST_URL, body, HTTP_MAX_RETRIES, HTTP_RETRY_DELAY_MS, "HTTP");
}

// ── Heartbeat (esp32-pir 방식: 부팅 1회 / 주기 / Wi-Fi 재연결 / 방 전환) ──
void handleHeartbeat() {
  bool connected = (WiFi.status() == WL_CONNECTED);
  if (connected && !wasWifiConnected && lastHeartbeatMs != 0) {
    heartbeatPending = true;
    Serial.println("[HB] wifi reconnected, heartbeat queued");
  }
  wasWifiConnected = connected;
  if (!connected) return;

  unsigned long now = millis();
  bool periodDue = (lastHeartbeatMs != 0) && (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS);
  if (heartbeatPending || periodDue) {
    heartbeatPending = false;
    lastHeartbeatMs = now;
    String body = String("{\"deviceId\":\"") + currentDeviceId() + "\"}";
    postJson(HEARTBEAT_URL, body, HEARTBEAT_MAX_RETRIES, HEARTBEAT_RETRY_DELAY_MS, "HB");
  }
}

// ── BOOT 버튼: 다음 방 ──────────────────────────────────────────────────
void printRoom() {
  Serial.printf("[Room] %d/%d %s (%s)\n", roomIndex + 1, ROOM_COUNT, ROOM_NAMES[roomIndex],
                currentDeviceId());
}

void handleButton() {
  int level = digitalRead(BOOT_BUTTON_PIN);
  unsigned long now = millis();
  if (level == lastButtonLevel || now - lastButtonChangeMs < BUTTON_DEBOUNCE_MS) return;
  lastButtonChangeMs = now;
  lastButtonLevel = level;
  if (level != LOW) return;  // 누르는 순간만

  roomIndex = (roomIndex + 1) % ROOM_COUNT;
  posture_vote_reset(&voter);  // 새 방의 첫 확정 자세는 바로 전송
  heartbeatPending = true;     // 새 DEVICE_ID 도 online 으로 보이게
  printRoom();
}

// ── 카메라 ──────────────────────────────────────────────────────────────
bool cameraInit() {
  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[Cam] init failed 0x%x\n", err);
    return false;
  }
  rgbBuf = (uint8_t *)ps_malloc(CAPTURE_WIDTH * CAPTURE_HEIGHT * 3);
  if (!rgbBuf) {
    Serial.println("[Cam] PSRAM alloc failed (Tools > PSRAM: OPI PSRAM 확인)");
    return false;
  }
  return true;
}

// Edge Impulse signal 콜백: 모델 입력 크기로 줄인 RGB888 → 0xRRGGBB float
static int getSignalData(size_t offset, size_t length, float *out) {
  size_t px = offset * 3;
  for (size_t i = 0; i < length; i++, px += 3) {
    out[i] = (rgbBuf[px] << 16) + (rgbBuf[px + 1] << 8) + rgbBuf[px + 2];
  }
  return 0;
}

// TODO(EI): 라벨 이름이 다르면 여기 문자열을 Edge Impulse 프로젝트 라벨과 맞춘다.
static Posture labelToPosture(const char *label) {
  if (strcmp(label, "standing") == 0) return POSTURE_STANDING;
  if (strcmp(label, "sitting") == 0) return POSTURE_SITTING;
  if (strcmp(label, "lying") == 0) return POSTURE_LYING;
  if (strcmp(label, "no_person") == 0) return POSTURE_NO_PERSON;
  return POSTURE_UNKNOWN;
}

// 프레임 1장 분류. 실패하면 false.
bool classifyFrame(Posture *outPosture, float *outConfidence) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[Cam] capture failed");
    return false;
  }
  bool ok = fmt2rgb888(fb->buf, fb->len, PIXFORMAT_JPEG, rgbBuf);
  esp_camera_fb_return(fb);  // 원본 프레임은 즉시 반환 — 저장·전송하지 않는다
  if (!ok) return false;

  // 같은 버퍼 안에서 모델 입력 크기(EI_CLASSIFIER_INPUT_WIDTH x HEIGHT)로 crop + resize
  ei::image::processing::crop_and_interpolate_rgb888(
      rgbBuf, CAPTURE_WIDTH, CAPTURE_HEIGHT, rgbBuf, EI_CLASSIFIER_INPUT_WIDTH,
      EI_CLASSIFIER_INPUT_HEIGHT);

  ei::signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &getSignalData;

  ei_impulse_result_t result = {};
  EI_IMPULSE_ERROR err = run_classifier(&signal, &result, false);
  if (err != EI_IMPULSE_OK) {
    Serial.printf("[EI] run_classifier failed %d\n", err);
    return false;
  }
  size_t best = 0;
  for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
    if (result.classification[i].value > result.classification[best].value) best = i;
  }
  *outPosture = labelToPosture(result.classification[best].label);
  *outConfidence = result.classification[best].value;
  return true;
}

void handleInference() {
  unsigned long now = millis();
  if (now - lastInferenceMs < INFERENCE_INTERVAL_MS) return;
  lastInferenceMs = now;

  Posture p;
  float c;
  if (!classifyFrame(&p, &c)) return;
  VoteResult r = posture_vote_push(&voter, p, c);
  if (r.send) {
    Serial.printf("[Posture] %s %s (%.2f) → POST\n", ROOM_NAMES[roomIndex],
                  posture_api_name(r.posture), r.confidence);
    postPosture(r.posture, r.confidence);
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(500);
  Serial.println("\n[Boot] 별일없지 XIAO posture demo");
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  posture_vote_init(&voter, VOTE_FRAMES, MIN_CONFIDENCE);
  if (!cameraInit()) {
    Serial.println("[Boot] camera unavailable — halt");
    while (true) delay(1000);
  }
  printRoom();
  wifiConnect();
}

void loop() {
  wifiConnect();
  handleButton();
  handleHeartbeat();
  handleInference();
  delay(10);
}
