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
| 스케치 컴파일 | ⏳ 미검증 — Edge Impulse 라이브러리 연결 후 |
| 실기기 (카메라 · 추론 · 전송) | ⏳ 미검증 |

## 동작

- **BOOT 버튼(GPIO0)**: 다음 방으로 순환(`xiao-living` → `xiao-kitchen` → `xiao-bed`), 투표 버퍼 초기화, 시리얼에 현재 방 출력.
- 방 전환 직후 첫 확정 자세는 바로 전송. 이후에는 자세가 바뀔 때만 전송. `no_person` 은 전송 안 함.
- confidence 0.6 미만 프레임은 투표에서 제외 (`config.h`).
- heartbeat 는 esp32-pir 와 같은 방식 (부팅 1회 · 10분 주기 · Wi-Fi 재연결 · 방 전환 시 새 DEVICE_ID).
- 원본 영상은 저장·전송하지 않는다.

## 준비

1. `cp secrets.example.h secrets.h` 후 Wi-Fi · `DEVICE_KEY` 입력 (`secrets.h` 는 커밋 금지).
2. 데모 기기 등록: `node scripts/register-xiao-demo-devices.mjs --guardian-uid <UID>` (dry-run) → 확인 후 `--apply`.
3. Arduino IDE: 보드 `XIAO_ESP32S3`, PSRAM `OPI PSRAM`.

## Edge Impulse 라이브러리 연결 (교체할 부분)

- 설치 위치: Edge Impulse Studio > Deployment > **Arduino library** zip → Arduino IDE `Sketch > Include Library > Add .ZIP Library` (→ `Documents/Arduino/libraries/<프로젝트>_inferencing/`).
- `xiao-posture.ino` 의 `#include <xiao_posture_inferencing.h>` 를 zip 안 `src/<프로젝트>_inferencing.h` 이름으로 바꾼다 (`TODO(EI)` 1).
- 라벨이 `standing/sitting/lying/no_person` 과 다르면 `labelToPosture()` 문자열을 맞추고 (`TODO(EI)` 2), `.github/workflows/ci.yml` 의 xiao-posture 컴파일 단계 주석을 푼다.

## 단위 테스트

```
g++ -std=c++17 -Wall -Wextra -Werror -I firmware/xiao-posture firmware/xiao-posture/tests/posture_vote_test.cpp -o posture_vote_test
./posture_vote_test
```
