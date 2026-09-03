/*
 * 별일없지 (Byeolil Eopji) — ESP32-S3 + HC-SR501 PIR 모션센서 펌웨어
 *
 *   사람 움직임 → HC-SR501 → ESP32-S3 → Wi-Fi → HTTPS POST
 *     → Cloudflare Worker(/ingest-device-event) → Firestore events
 *     → onSnapshot → 별일없지 앱 → "거실에서 활동이 확인됐어요."
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
  wifiConnect();   // 끊기면 주기적으로 재연결 (내부에서 간격 제한)
  handlePir();
  delay(50);       // 짧은 폴링 간격
}
