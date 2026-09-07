/*
 * 별일없지 (Byeolil Eopji) — ESP32-S3 + HC-SR501 PIR 모션센서 펌웨어
 *
 *   사람 움직임 → HC-SR501 → ESP32-S3 → Wi-Fi → POST /ingest-device-event
 *     → Firestore events → onSnapshot → 앱 → "거실에서 활동이 확인됐어요."   (사람 활동 신호)
 *
 *   주기적 heartbeat → POST /device-heartbeat                                (기기 생존 신호, Phase 4.1b)
 *     → devices/{id}.lastHeartbeatAt → 앱 deriveDeviceHealth() → online/offline
 *
 * 대상 보드: ESP32-S3 DevKitC-1 (N16R8 등)
 * 필요 라이브러리: 없음 (ESP32 Arduino core 기본 WiFi / WiFiClientSecure / HTTPClient)
 *
 * 배선 / 업로드 방법은 이 폴더의 README.md 참고.
 * 실제 비밀 값은 secrets.h (secrets.example.h 를 복사).
 *
 * ⚠️ 이 펌웨어에는 Firebase Admin credential / service account / private key 가 없다.
 *    그런 값을 여기에 절대 넣지 않는다. 서버(Worker)가 Firestore 쓰기를 담당한다.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#include "config.h"
#include "secrets.h"

// ── 상태 ────────────────────────────────────────────────────────────────
static bool          pirWarmedUp        = false;
static unsigned long bootMillis         = 0;
static int           lastPirState       = LOW;
static unsigned long lastMotionSentMs   = 0;
static unsigned long lastWifiAttemptMs  = 0;

// heartbeat (Phase 4.1b)
static unsigned long lastHeartbeatMs    = 0;
static bool          heartbeatPending   = true;   // 부팅 후 첫 heartbeat 를 즉시 보낸다
static bool          wasWifiConnected   = false;  // 재연결 감지용

// ── Wi-Fi ───────────────────────────────────────────────────────────────
void wifiConnect() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS && lastWifiAttemptMs != 0) {
    return;  // 재시도 간격 대기 (busy-loop 금지)
  }
  lastWifiAttemptMs = now;

  Serial.printf("[WiFi] connecting to \"%s\" ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
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

// ── HTTPS POST ──────────────────────────────────────────────────────────
// 반환: HTTP status code (>0 성공/실패 코드), 또는 <0 전송 자체 실패
int postEvent(const char *eventType) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] skip: WiFi not connected");
    return -1;
  }

  // PoC: 인증서 검증 생략. Phase 4 에서 Cloudflare 루트 CA 핀 고정 예정.
  WiFiClientSecure client;
  client.setInsecure();

  String body = String("{\"deviceId\":\"") + DEVICE_ID +
                "\",\"eventType\":\"" + eventType + "\"}";

  int lastCode = -1;
  for (int attempt = 1; attempt <= HTTP_MAX_RETRIES; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(client, INGEST_URL)) {
      Serial.println("[HTTP] begin() failed");
      lastCode = -1;
    } else {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Key", DEVICE_KEY);

      Serial.printf("[HTTP] POST /ingest-device-event (attempt %d/%d)\n",
                    attempt, HTTP_MAX_RETRIES);
      lastCode = http.POST(body);

      if (lastCode > 0) {
        String resp = http.getString();
        Serial.printf("[HTTP] %d %s\n", lastCode, resp.c_str());
      } else {
        Serial.printf("[HTTP] transport error: %s\n",
                      http.errorToString(lastCode).c_str());
      }
      http.end();
    }

    if (lastCode >= 200 && lastCode < 300) {
      Serial.println("[Event] sent successfully");
      return lastCode;
    }
    if (lastCode == 401 || lastCode == 403 || lastCode == 404) {
      // 설정 문제 — 재시도해도 소용없음
      Serial.printf("[HTTP] failed: %d (config error, not retrying)\n", lastCode);
      return lastCode;
    }

    Serial.printf("[HTTP] failed: %d\n", lastCode);
    if (attempt < HTTP_MAX_RETRIES) delay(HTTP_RETRY_DELAY_MS);
  }

  Serial.println("[Event] giving up until next motion");
  return lastCode;
}

// ── Heartbeat (Phase 4.1b) ──────────────────────────────────────────────
// devices/{id}.lastHeartbeatAt 만 갱신한다. events 문서는 만들지 않는다.
// 반환: HTTP status code (>0), 또는 <0 전송 자체 실패
int sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HB] skip: WiFi not connected");
    return -1;
  }

  WiFiClientSecure client;
  client.setInsecure();  // PoC: 인증서 검증 생략 (postEvent 와 동일)

  String body = String("{\"deviceId\":\"") + DEVICE_ID + "\"}";

  int lastCode = -1;
  for (int attempt = 1; attempt <= HEARTBEAT_MAX_RETRIES; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);

    if (!http.begin(client, HEARTBEAT_URL)) {
      Serial.println("[HB] begin() failed");
      lastCode = -1;
    } else {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Device-Key", DEVICE_KEY);

      Serial.printf("[HB] POST /device-heartbeat (attempt %d/%d)\n",
                    attempt, HEARTBEAT_MAX_RETRIES);
      lastCode = http.POST(body);

      if (lastCode > 0) {
        String resp = http.getString();
        Serial.printf("[HB] %d %s\n", lastCode, resp.c_str());
      } else {
        Serial.printf("[HB] transport error: %s\n",
                      http.errorToString(lastCode).c_str());
      }
      http.end();
    }

    if (lastCode >= 200 && lastCode < 300) return lastCode;
    if (lastCode == 401 || lastCode == 403 || lastCode == 404) {
      Serial.printf("[HB] failed: %d (config error, not retrying)\n", lastCode);
      return lastCode;
    }

    Serial.printf("[HB] failed: %d\n", lastCode);
    if (attempt < HEARTBEAT_MAX_RETRIES) delay(HEARTBEAT_RETRY_DELAY_MS);
  }

  Serial.println("[HB] giving up until next interval");
  return lastCode;
}

// millis() 기반 non-blocking. loop() 의 짧은 폴링 구조를 유지한다.
//   A) 부팅 후 Wi-Fi 연결되면 1회      (heartbeatPending 초기값 true)
//   B) 이후 HEARTBEAT_INTERVAL_MS 마다
//   C) Wi-Fi 가 끊겼다 다시 연결되면 최대한 빨리
void handleHeartbeat() {
  bool connected = (WiFi.status() == WL_CONNECTED);

  // (C) 재연결 감지 — 최초 연결(lastHeartbeatMs==0)은 (A)가 처리하므로 제외
  if (connected && !wasWifiConnected && lastHeartbeatMs != 0) {
    heartbeatPending = true;
    Serial.println("[HB] wifi reconnected, heartbeat queued");
  }
  wasWifiConnected = connected;
  if (!connected) return;

  unsigned long now = millis();
  bool periodDue =
      (lastHeartbeatMs != 0) && (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS);

  if (heartbeatPending || periodDue) {
    heartbeatPending = false;
    lastHeartbeatMs = now;
    sendHeartbeat();
  }
}

// ── PIR ─────────────────────────────────────────────────────────────────
void handlePir() {
  unsigned long now = millis();

  if (!pirWarmedUp) {
    if (now - bootMillis >= PIR_WARMUP_MS) {
      pirWarmedUp = true;
      Serial.println("[PIR] warmup done, sensing active");
    } else {
      return;
    }
  }

  int state = digitalRead(PIR_PIN);

  // LOW -> HIGH 상승 에지에서만 이벤트 1회
  if (state == HIGH && lastPirState == LOW) {
    if (lastMotionSentMs == 0 || now - lastMotionSentMs >= MOTION_COOLDOWN_MS) {
      Serial.println("[PIR] motion detected");
      lastMotionSentMs = now;
      postEvent("motion_detected");
    } else {
      Serial.println("[PIR] motion (in cooldown, ignored)");
    }
  }
  lastPirState = state;
}

// ── Arduino ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);
  Serial.println();
  Serial.println("[별일없지] ESP32-S3 PIR firmware");
  Serial.printf("[cfg] device=%s pin=%d cooldown=%lums\n",
                DEVICE_ID, PIR_PIN, MOTION_COOLDOWN_MS);

  pinMode(PIR_PIN, INPUT);
  bootMillis = millis();

  wifiConnect();
  Serial.printf("[PIR] warming up %lus ...\n", PIR_WARMUP_MS / 1000);
}

void loop() {
  wifiConnect();      // 끊기면 주기적으로 재연결 (내부에서 간격 제한)
  handlePir();        // 사람 활동 신호 (HC-SR501 → GPIO4 상승 에지)
  handleHeartbeat();  // 기기 생존 신호 (Phase 4.1b, non-blocking)
  delay(50);          // 짧은 폴링 간격
}
