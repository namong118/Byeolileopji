# 별일없지 — XIAO ESP32-S3 Sense 자세 인식 데모 펌웨어

```
모니터의 AI 영상 → XIAO 카메라 → Edge Impulse 분류(standing/sitting/lying/no_person)
  → 최근 5프레임 다수결 → 자세가 바뀔 때만 POST /ingest-device-event
     { deviceId, eventType: "motion_detected", posture, confidence }
  → Firestore events.payload.posture → 앱 "거실에서 앉아 있어요."
```

## 상태

| 항목 | 상태 |
| --- | --- |
| `posture_vote.h` 다수결 로직 | ✅ g++ 단위 테스트 (`tests/posture_vote_test.cpp`, CI) |
| 스케치 컴파일 | ⏳ EI 라이브러리 연결됨, 로컬 미검증 — CI firmware 잡에서 확인 |
| 실기기 (카메라 · 추론 · 전송) | ⏳ 미검증 |

## 동작

- **BOOT 버튼(GPIO0)**: 다음 방으로 순환(`xiao-living` → `xiao-kitchen` → `xiao-bed`), 투표 버퍼 초기화, 시리얼에 현재 방 출력.
- 방 전환 직후 첫 확정 자세는 바로 전송. 이후에는 자세가 바뀔 때만 전송. `no_person` 은 전송 안 함.
- confidence 0.6 미만 프레임은 투표에서 제외 (`config.h`).
- heartbeat 는 esp32-pir 와 같은 방식 (부팅 1회 · 10분 주기 · Wi-Fi 재연결 · 방 전환 시 새 DEVICE_ID).
- 원본 영상은 저장·전송하지 않는다.

## 판단 근거 스냅샷 (`DEMO_SNAPSHOT`, 기본 꺼짐)

데모에서 "왜 이 자세로 판단했는지"를 보여주기 위한 선택 기능이다. 스트리밍이 아니다.

- `config.h` 의 `DEMO_SNAPSHOT` 을 `true` 로 바꾸면, 자세가 확정돼 전송하는 순간의 프레임(JPEG) **1장만** RAM 에 보관한다. 다음 확정 때 덮어쓴다.
- 로컬 네트워크에서 `GET http://<XIAO IP>:81/snapshot` 으로 받을 수 있다 (CORS 허용, `X-Snapshot-Seq` 헤더).
- 이벤트 POST 에는 사진 대신 `snapshotSeq`(증가 번호)만 넣는다. 웹 데모가 이 번호로 사진과 이벤트를 맞춘다.
- **원칙: 사진은 로컬 네트워크로만 제공하고 서버(Worker · Firestore)로 전송·저장하지 않는다.** 플래시·SD 에도 쓰지 않으며 전원을 끄면 사라진다. 실제 보호대상 환경에서는 켜지 않는다.
- 웹 데모는 `EXPO_PUBLIC_DEMO_SNAPSHOT_URL=http://<XIAO IP>:81/snapshot` 이 있을 때만 받아서 브라우저 메모리에만 둔다. https 로 호스팅한 페이지에서는 브라우저가 http 요청을 막으므로 로컬(`npx expo start --web`)에서 쓴다.

## 준비

1. `cp secrets.example.h secrets.h` 후 Wi-Fi · `DEVICE_KEY` 입력 (`secrets.h` 는 커밋 금지).
2. 데모 기기 등록: `node scripts/register-xiao-demo-devices.mjs --guardian-uid <UID>` (dry-run) → 확인 후 `--apply`.
3. Arduino IDE: 보드 `XIAO_ESP32S3`, PSRAM `OPI PSRAM`.

## Arduino IDE 업로드

1. `Sketch > Include Library > Add .ZIP Library` 로 `lib/ei-byeolileopji-posture-arduino-1.0.1.zip` 추가 (헤더 `byeolileopji-posture_inferencing.h`, 라벨 lying/no_person/sitting/standing).
2. `Tools > Board` 에서 `XIAO_ESP32S3` 선택.
3. `Tools > PSRAM` 을 `OPI PSRAM` 으로 설정 (안 하면 카메라·추론 버퍼 할당 실패).
4. `cp secrets.example.h secrets.h` 후 Wi-Fi · `DEVICE_KEY` · URL 입력 (커밋 금지).
5. 결정 사진이 필요하면 `config.h` 의 `DEMO_SNAPSHOT` 을 `true` 로 (로컬 `:81/snapshot` 만, 서버 전송 없음) → 업로드 후 시리얼 115200 에서 `[EI] NNNms ...` 확인.

## 단위 테스트

```
g++ -std=c++17 -Wall -Wextra -Werror -I firmware/xiao-posture firmware/xiao-posture/tests/posture_vote_test.cpp -o posture_vote_test
./posture_vote_test
```
