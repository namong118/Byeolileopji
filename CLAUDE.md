@AGENTS.md

# 작업 규칙

여러 계정·세션에서 번갈아 작업한다. 어느 세션이든 아래 규칙을 따른다.
자세한 경위와 기록은 `docs/BUILD_LOG.md` 에 있고, 여기에는 규칙만 둔다.

## 1. 레포 구성

| 경로 | 역할 |
| --- | --- |
| `app/`, `src/` | 보호자 앱 (Expo React Native, expo-router) |
| `server/cloudflare-worker/` | 디바이스 이벤트 수신(ingest) · Cron 상태 판정 · FCM 알림 Worker |
| `firmware/esp32-pir/` | ESP32 PIR 센서 펌웨어 |
| `scripts/` | 스모크 테스트 · Rules 에뮬레이터 테스트 |
| `edge/vision/training/` | 사람 검출 모델 학습·평가 스크립트 (Python, 데이터·가중치는 레포 밖) |
| `firestore.rules`, `firestore.indexes.json` | Firestore 보안 규칙 · 복합 인덱스 |
| `docs/BUILD_LOG.md` | 작업 기록 · 배포 기록 · 운영 확인 체크리스트 |

- 판정 코어 `src/services/careStatusSnapshot.ts` 는 앱과 Worker 가 **공유**한다.
  Worker 는 `server/cloudflare-worker/src/careStatusReader.js` 에서 이 파일과
  `careStatusSnapshotInput.ts` 를 직접 import 한다.
- 관련 레포: `namong118/physical-ai` (소개 홈페이지 · PRD · 설계 문서).

## 2. 배포·운영

- Claude Code 는 운영 배포 명령(`firebase deploy`, `wrangler deploy`, `wrangler rollback` 등)을
  **실행하지 않는다.** README 와 BUILD_LOG 의 배포 절차는 사용자가 직접 실행하기 위한 안내다.
  필요하면 실행할 명령과 확인 방법을 정리해 사용자에게 넘긴다.
  예외로 `npx wrangler deploy --dry-run` (번들만 만들고 업로드하지 않음)은 해도 된다.
  그 밖의 배포 명령은 dry-run 성격의 옵션이 있어도 실행하지 않는다.
- 배포 순서: **Firestore 인덱스가 Console 에서 "사용 설정됨" 이 된 뒤 → Worker → 앱.**
  인덱스 빌드 전에 Worker 를 배포하면 Cron 이 실패한다.
  → `docs/BUILD_LOG.md` 의 "운영 배포 체크리스트 (순서 중요)" 절.
- **새 eventType 을 추가할 때는 앱을 먼저 배포하고 Worker 는 그다음.**
  앱 mapper(`src/mappers/firestoreEventMapper.ts` 의 `coerceEventType`)는 모르는 eventType 을
  오류 없이 `motion_detected` 로 바꾼다. Worker 가 먼저 새 타입을 받으면 이전 앱에서는
  그 이벤트가 움직임으로 잘못 표시·계산된다.
- Worker 배포 후 이상이 있을 때의 롤백 판단과 절차는 `docs/BUILD_LOG.md` 의
  "운영 확인 체크리스트" 절 2번 항목을 따른다 (롤백 실행은 사용자).

## 3. 판정 로직

- eventType 화이트리스트는 **세 곳을 함께** 수정한다.
  - Worker: `server/cloudflare-worker/src/validate.js` 의 `ALLOWED_EVENT_TYPES`
    (디바이스 종류별 제한 `DEVICE_TYPE_EVENTS` 도 확인)
  - 앱 타입: `src/types/events.ts` 의 `EventType`
  - 앱 mapper: `src/mappers/firestoreEventMapper.ts` 의 `EVENT_TYPES`
  - 표시 문구(`src/utils/eventPresenter.ts`)와 판정 집합(`src/services/eventViews.ts`,
    `src/utils/todayActivity.ts`)에 넣을지는 아래 규칙에 따라 따로 정한다.
- Vision 이벤트는 처음에 `ACTIVITY_EVENT_TYPES`(`src/services/eventViews.ts`) 등 **판정 집합에
  넣지 않고 Timeline 표시만** 한다. 부재·시야 밖 같은 이벤트가 활동으로 계산되면 CHECK 판정이
  거꾸로 된다.
- `careStatusSnapshot` 의 **판정 동작 변경은 별도 승인**을 받는다. 판정 동작을 바꾸지 않는
  입력 데이터 보완(`careStatusSnapshotInput.ts` 쪽 정규화 등)은 해도 된다.
- **시간 범위로 정의된 판정·표시**(예: 최근 12시간 SOS, 오늘 활동 수)는 "최근 N건" 조회만으로
  구현하지 않는다. 시간 범위 쿼리를 쓰고, 안전 상한에 걸리면 잘렸다는 사실을 드러낸다
  (예: `todayTruncated` → "N회 이상"). 개수 기준 조회는 활동이 많으면 에러 없이 입력을 잘라낸다.
  → `docs/BUILD_LOG.md` 의 "Fix — 조회 창(최근 N건) vs 시간 기준 판정 불일치 + 미등록
  deviceType 우회 차단" 절.

## 4. Vision 확장 (실시간 파이프라인 코드는 아직 없음, 학습 스크립트만 있음)

- Vision 코드를 추가할 때는 `edge/vision/` (Python) 에 두고, 기존 JS/TS 빌드
  (`tsc`, `expo lint`, Worker 번들)와 분리한다.
- 이벤트는 공통 형식을 따른다: `location`, `state`, `startedAt`, `endedAt`, `confidence`, `source`.
- 원본 영상은 저장하지 않고 전송하지 않는다.
- 측정하지 않은 수치를 측정한 것처럼 쓰지 않는다. 검증하지 않은 것은 "미검증" 으로 기록한다.

## 5. 검증

- 변경 후 실행한다:
  - `npm run test:smoke`
  - `npm run typecheck`
  - `npm run lint`
  - `firestore.rules` 를 바꿨으면 `npm run test:rules:emulator`
- 실행하지 못한 검증은 PASS 로 처리하지 않는다. "미실행" 과 그 이유를 기록한다.

## 6. git

- 커밋 메시지는 기존 이력 형식을 따른다: `type: 영어 소문자 요약` (`feat` / `fix` / `docs` / `chore`).
- **push 는 사용자가 직접 한다.** 요청이 없으면 push 하지 않는다.
- 커밋을 합칠 때(fixup, amend)는 먼저 그 커밋이 `origin/main` 에 올라갔는지 확인한다
  (`git branch -r --contains <커밋>`). 올라갔으면 합치지 말고 새 커밋을 만든다.
- 강제 push(`--force`, `--force-with-lease`)는 하지 않는다.
- 미추적 파일은 지시 없이 스테이징하지 않는다. `git add -A` / `git add .` 대신 파일을 지정한다.

## 7. 비밀 정보

- secret · API 키 · 서비스 계정 파일은 커밋하지 않는다. 커밋하는 것은 템플릿 파일뿐이다.

  | 커밋하지 않는 파일 | 커밋하는 템플릿 |
  | --- | --- |
  | `server/cloudflare-worker/.dev.vars`, `.dev.vars.*` | `server/cloudflare-worker/.dev.vars.example` |
  | `firmware/esp32-pir/secrets.h` | `firmware/esp32-pir/secrets.example.h` |
  | `.env`, `.env.*`, `.env*.local` | `.env.example` |
  | `google-services.json`, `GoogleService-Info.plist` | — |
  | 서비스 계정 JSON (`*serviceAccount*.json`, `*-firebase-adminsdk-*.json`) | — |
  | 서명 키·인증서 (`*.jks`, `*.p8`, `*.p12`, `*.key`, `*.pem`) | — |

- 위 파일은 모두 `.gitignore` 에 있다. 새 종류의 비밀 파일을 만들면 `.gitignore` 에 먼저 추가한다.
- Worker 운영 secret 은 `wrangler secret` 으로만 넣는다. `wrangler.toml` 의 `[vars]` 에는
  공개돼도 되는 설정값만 둔다.
- 문서·커밋 메시지·로그에도 키 값, 개인 정보, 로컬 경로를 쓰지 않는다 (공개 레포).

## 8. 작업 방식

- 큰 작업은 **조사 → 계획 보고 → 승인 후 구현** 순서로 한다. 조사 단계에서는 파일을 바꾸지 않는다.
- 세션을 마칠 때 `docs/BUILD_LOG.md` 에 다음을 기록한다:
  - 한 일
  - 진행 중인 작업의 상태
  - 남은 일
- 테스트 수, 구현 상태, 측정 결과처럼 `namong118/physical-ai` 홈페이지 문구에 영향을 주는 변경을
  하면, BUILD_LOG 의 남은 일에 `홈페이지 반영 필요: (내용)` 으로 기록한다.
