# 별일없지

**Byeolil Eopji**

> 별일 없는 하루를 위해.

집 안의 IoT 센서와 집 밖의 스마트워치를 연결해 고령자의 일상 속 돌봄 사각지대를
줄이고 가족에게 안심을 전달하는 통합 생활안전 서비스.

---

## 문제

혼자 생활하는 고령자의 일상을 가족이 지속적으로 확인하기 어렵고,
집 안과 집 밖 사이에 돌봄 공백이 발생한다.

## 해결 방향

```text
집 안
IoT Sensor
          ↘
           별일없지  →  보호자
          ↗
집 밖
Smart Watch
```

생활 데이터로 복약 관리도 향후 통합한다.

---

## Current Progress

```text
Phase 1    ✅  Guardian App + Mock Event Pipeline
Phase 2    ⏭️  Supabase Backend (구현했으나 hosted 검증 전 Firebase 로 전환)
Phase 2.5  ✅  Firebase Firestore Persistence + Realtime (hosted 검증 완료)
Phase 3    🚧  ESP32-S3 + PIR 센서 실연동
              ├─ ✅  서버 ingest endpoint (Cloudflare Worker) — 배포 + curl → Firestore
              │       → 앱 onSnapshot 실시간 반영까지 hosted 검증 완료
              ├─ ✅  ESP32 펌웨어 코드 + 배선/업로드 문서
              └─ ⏳  실물 하드웨어(HC-SR501 PIR / ESP32-S3) end-to-end 검증  ← pending
Phase 4    ⏳  NORMAL / CHECK 자동 판단 (무활동 시간 기반) + 보호자 인증/규칙
Phase 5    ⏳  복약 관리 + 스마트워치 Mock 통합
```

> **Phase 2 → 2.5 전환:** Supabase 연동 코드를 작성했으나 hosted 검증 전
> **Firebase Firestore 로 백엔드를 전환**했다. Supabase 코드는 제거됨 (git `c8392af`).
> Phase 2.5 의 hosted Firestore WRITE / READ / 재시작 persistence / 외부 문서 → 앱 실시간
> 반영은 **실제로 검증 완료**.
>
> **Phase 3 현황:** ESP32 가 Firestore 에 직접 쓰지 않고
> `ESP32 → HTTPS → Cloudflare Worker → Firestore` 구조.
> **서버 파이프라인(배포 → `GET /health` → `X-Device-Key` 인증 → `POST /ingest-device-event`
> HTTP 201 → `devices/dev-device-livingroom` 조회 → `events` 문서 생성 → Expo 앱
> onSnapshot 실시간 반영)까지 hosted 검증 완료.**
> **실물 센서(HC-SR501 PIR / ESP32-S3) end-to-end 는 하드웨어 도착 후 검증**
> (상세: `firmware/esp32-pir/README.md`).

---

## 최종 PoC 목표 (2026-09-27)

```text
PIR Sensor → ESP32-S3 → Wi-Fi → HTTPS endpoint → Firestore
                                                     ↓ onSnapshot
                                                별일없지 App
                                                     ↓
                          최근 활동 표시 / 일정 시간 무활동 시 CHECK 상태
```

---

## 기술 스택

- Expo (SDK 57) / React Native 0.86 / React 19
- TypeScript (strict)
- expo-router (파일 기반 네비게이션)
- zustand (UI 상태)
- **firebase (JS SDK) — Cloud Firestore (영속 저장 + 실시간 구독)**

> `@react-native-firebase/*` 는 쓰지 않는다. Expo managed workflow / Expo Go 에서
> 바로 동작하는 Firebase **JS SDK** (`firebase`) 를 사용한다.

---

## Firebase Architecture

앱은 저장소 추상화(`EventRepository`)의 구현체만 바꿔 연결한다 —
UI·store·service 코드는 Phase 1 과 동일하다.

```text
Developer Simulation  (버튼)
        ↓
CareEvent 생성
        ↓
careStore  →  EventService  →  EventRepository
                               ├─ FirestoreEventRepository   (Firebase config 있을 때)
                               └─ InMemoryEventRepository     (폴백, 목업)
        ↓
Cloud Firestore  (events 컬렉션)
        ↓
onSnapshot 실시간 구독  →  careStore  →  Home / Timeline (자동 갱신)
```

- 앱을 완전히 종료했다가 다시 열어도 이전 이벤트가 남아 있다.
- 외부(Phase 3 의 ESP32)에서 `events` 컬렉션에 문서가 추가되면
  `onSnapshot` 이 감지 → 화면이 자동 갱신된다.
- 실시간 구독은 **store 계층에서 1개만** 관리한다 (화면마다 만들지 않음).
  앱 언마운트 시 `teardown()` 으로 해제한다.

### Realtime Event Flow

```text
앱 시작
  → careStore.init()
  → Firestore 최초 load (getDocs)
  → subscribeToEvents() 로 onSnapshot 구독 시작 (1회)

events 문서 추가 (앱 내부 시뮬레이션 or 외부 ESP32)
  → onSnapshot 콜백 (전체 최신 목록 전달)
  → deriveEventViews() 로 events / todayEvents / lastActivity 재계산
  → careStore.set(...)
  → Home / Timeline 자동 반영
```

---

## Environment Variables

`.env.example` 를 복사해 `.env` 를 만든다. (`.env` 는 git 에 커밋되지 않는다)

```bash
cp .env.example .env
```

| 변수 | 설명 |
| --- | --- |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Firebase Web 앱 API key |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | `<project-id>.firebaseapp.com` |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | 프로젝트 ID |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | `<project-id>.appspot.com` |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | 발신자 ID |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Web 앱 App ID |
| `EXPO_PUBLIC_CARE_RECIPIENT_ID` | (선택) 개발용 보호대상 ID 오버라이드 |
| `EXPO_PUBLIC_DEVICE_ID` | (선택) 개발용 디바이스 ID 오버라이드 |

값은 **Firebase Console > 프로젝트 설정(⚙️) > 일반 > 내 앱 > Web 앱** 의
`firebaseConfig` 객체에서 그대로 옮겨 적는다.

- 앱이 Firestore 를 쓰려면 최소 `API_KEY` · `PROJECT_ID` · `APP_ID` 가 모두 있어야 한다.
  하나라도 비면 자동으로 **In-Memory 모드**로 폴백한다.
- 위 Web config 값은 클라이언트에 노출되어도 되는 값이다. 보안은 **Firestore 규칙**으로 건다.
- 환경변수를 바꾼 뒤에는 캐시를 비우고 재시작한다: `npm start -c`

> ⚠️ Firebase **service account JSON / Admin SDK private key** 는 이 앱/저장소에
> **절대** 넣지 않는다. Phase 3 의 서버(HTTPS ingest endpoint)에서만 쓴다.

---

## Firebase Console Setup (사람이 직접)

1. [console.firebase.google.com](https://console.firebase.google.com) → **프로젝트 추가**
   → 이름 `byeolileopji` (Google Analytics 는 꺼도 됨)
2. 프로젝트 개요 화면에서 **웹 아이콘 `</>`** 클릭 → 앱 닉네임 `byeolileopji-app`
   등록 (Firebase Hosting 체크 불필요) → **Firebase SDK 추가** 화면의
   `firebaseConfig` 값 6개를 복사
3. 프로젝트 루트에서 `cp .env.example .env` 후, 복사한 값을 `EXPO_PUBLIC_FIREBASE_*` 에 붙여넣기
4. 좌측 메뉴 **빌드 > Firestore Database** → **데이터베이스 만들기**
   → 모드: **프로덕션 모드에서 시작** (규칙은 5번에서 별도 적용)
   → 위치: `asia-northeast3 (Seoul)` 권장 (변경 불가하니 주의)
5. **Firestore 규칙 적용** (둘 중 하나)
   - *Console*: Firestore Database > **규칙** 탭에 `firestore.rules` 내용을 붙여넣고 **게시**
   - *CLI*: `npm i -g firebase-tools` → `firebase login` →
     `firebase use --add` (프로젝트 선택) → `firebase deploy --only firestore`
     (`firebase.json` 이 `firestore.rules` + `firestore.indexes.json` 을 함께 배포)
6. **복합 인덱스 생성** — `events` 를 `careRecipientId ==` + `occurredAt desc` 로
   조회하므로 인덱스가 필요하다.
   - CLI 로 `firebase deploy --only firestore` 를 했다면 자동 생성됨
   - 아니면: 앱을 처음 실행하면 콘솔 로그에 인덱스 생성 링크가 뜬다 → 클릭해서 생성
   - 또는 Console > Firestore > **색인** 탭에서 수동 생성:
     컬렉션 `events`, 필드 `careRecipientId`(오름차순) + `occurredAt`(내림차순)
7. *(선택)* 개발용 seed 문서를 Console 에서 수동 생성:
   - `careRecipients/dev-care-recipient` → `{ name: "김영희" }`
   - `devices/dev-device-livingroom` → `{ careRecipientId: "dev-care-recipient",
     name: "거실 센서", type: "ESP32_PIR", location: "거실", enabled: true }`
   - (앱은 `events` 만 있으면 동작한다. 이 문서들은 Phase 3 대비 확인용)
8. `npm install` → `npm start -c` → 시뮬레이터/Expo Go 로 앱 실행
9. **개발자** 탭 상단 배지가 `Firebase Firestore (영속 저장) / 실시간 구독 연결됨` 인지 확인
10. **개발자** 탭에서 `거실 움직임` 등 버튼 클릭
11. Firebase Console > Firestore > `events` 컬렉션에 문서가 생겼는지 확인
    (필드: `eventType`, `source`, `location`, `occurredAt`, `createdAt` 등)
12. 앱을 완전히 종료 후 다시 실행 → 홈/타임라인에 그 이벤트가 그대로 있는지 확인
13. *(실시간 확인)* 앱을 켠 채로 Console 에서 `events` 에 문서를 직접 추가
    → 홈/타임라인이 몇 초 내 자동 갱신되는지 확인

---

## Firestore Collections

PoC 단계라 구조는 단순하게 유지한다.

### `events/{eventId}` — 핵심

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `careRecipientId` | string | 보호대상 ID (현재 `dev-care-recipient` 고정) |
| `deviceId` | string \| null | 디바이스 ID |
| `eventType` | string | `motion_detected` `door_opened` `left_home` `returned_home` `medication_taken` `medication_missed` `watch_activity` `sos_triggered` |
| `source` | string | `sensor` `watch` `medication` `system` |
| `location` | string \| null | 위치 이름 (예: `"거실"`) |
| `payload` | map | 추가 데이터 (기본 `{}`) |
| `occurredAt` | Timestamp | 이벤트 실제 발생 시각 (UTC) |
| `createdAt` | Timestamp | 서버 기록 시각 (`serverTimestamp()`) |

> `eventType` / `source` 값은 **기존 `CareEvent` 도메인 모델의 union 값과 동일**하다
> (소문자 snake_case). 새 enum 을 만들지 않았다. Firestore 문서 ↔ `CareEvent` 변환은
> `src/mappers/firestoreEventMapper.ts` 에서만 일어나며, Timestamp ↔ ISO 문자열
> 변환을 안전하게 처리한다.

### `careRecipients/{careRecipientId}`

`{ name: string, createdAt?, updatedAt? }` — Phase 4 에서 Auth 프로필과 연결.

### `devices/{deviceId}` — Phase 3 준비

```json
{
  "careRecipientId": "dev-care-recipient",
  "name": "거실 센서",
  "type": "ESP32_PIR",
  "location": "거실",
  "enabled": true
}
```

Phase 3 에서 ESP32 는 이벤트에 `deviceId` 만 실어 보내고,
서버가 이 문서를 조회해 `careRecipientId` / `location` 을 결정한다.

---

## Firestore Rules

`firestore.rules` — **⚠️ DEVELOPMENT ONLY / NOT FOR PRODUCTION**

아직 Firebase Auth 가 없어, 인증 없는 PoC 앱이 동작하도록 열어둔 상태다.

- 전체 DB 와일드카드(`match /{document=**}`)는 쓰지 않는다.
- `events`: `read` + `create` 허용, `update`/`delete` 금지.
- `careRecipients` / `devices`: `read` 만 허용 (앱은 쓰지 않음).

Phase 4 에서 좁힌다:

```
allow read:  if isLinkedGuardian(resource.data.careRecipientId);
allow write: if false;   // 쓰기는 서버(HTTPS endpoint)만
```

---

## Security Warning

- 현재 Firestore 규칙은 **누구나** anon 으로 `events` 를 읽고 쓸 수 있는 상태다.
  **Production-ready 가 아니다.** PoC / 데모 목적 한정.
- Firebase Web config 값은 secret 이 아니다. 하지만 **Admin SDK 서비스 계정 키**는
  절대 앱/저장소에 넣지 않는다 (`.gitignore` 에 패턴 추가됨).
- **Phase 3 방향 (미리 명시):** ESP32 펌웨어에 Firebase Admin credential /
  service account / private key 를 넣는 방식은 **금지**.
  `ESP32 → HTTPS POST endpoint → 검증 → Firestore` 구조를 쓴다.
  구체적 endpoint 는 Phase 3 에서 결정.

---

## 프로젝트 구조

```text
app/                         expo-router 라우트
  _layout.tsx                루트 (Provider + init + realtime teardown)
  (tabs)/_layout.tsx         하단 탭 (홈 / 오늘의 기록 / 개발자)
  (tabs)/index.tsx           홈
  (tabs)/timeline.tsx        오늘의 기록 (loading / empty / error 처리)
  (tabs)/developer.tsx       개발자 시뮬레이션 (Data Source + 실시간 상태 표시)

src/
  components/                재사용 UI (Card, StatusHero, TimelineList, Notice ...)
  config/
    env.ts                   EXPO_PUBLIC_* · firebaseConfig · isFirebaseConfigured()
    careContext.ts           개발용 보호대상/디바이스 ID (한 곳에서 관리)
  constants/                 theme(색·간격·타이포), strings(브랜드 문구)
  types/                     CareEvent / CareStatus 모델
  lib/
    firebase.ts              Firebase 초기화 · getFirestoreDb() (config 없으면 null)
  mappers/
    firestoreEventMapper.ts  Firestore 문서 ↔ CareEvent (런타임 import 없음, 순수)
  services/
    eventRepository.ts       EventRepository 인터페이스 (+ 선택 subscribeToEvents) + InMemory
    firestore/
      firestoreEventRepository.ts  Firestore 구현 (list/append/subscribe)
    eventViews.ts            deriveEventViews (순수 파생 로직)
    eventService.ts          도메인 로직 + 저장소 선택(팩토리) + EVENT_DATA_SOURCE
  stores/careStore.ts        UI 반응형 상태 (loading / error / dataSource / realtime)
  mock/                      보호대상 · seed 이벤트 · 시뮬레이션 버튼 정의
  utils/                     시간 포맷, 이벤트 → 한국어 문구, 홈 요약 계산

firebase.json                Firestore 배포 설정
firestore.rules              보안 규칙 (DEVELOPMENT ONLY)
firestore.indexes.json       복합 인덱스 정의

server/cloudflare-worker/    디바이스 이벤트 ingest endpoint (Phase 3)
  src/validate.js            요청/디바이스 검증 (순수)
  src/buildEvent.js          events 문서 생성 로직 (순수, 서버 timestamp)
  src/firestore.js           Firestore REST 헬퍼 (인증 없음 — DEVELOPMENT ONLY)
  src/index.js               Worker fetch 핸들러
  wrangler.toml / README.md

firmware/esp32-pir/          ESP32-S3 + HC-SR501 PIR 펌웨어 (Phase 3)
  esp32-pir.ino / config.h / secrets.example.h / README.md

scripts/phase25-smoke.mjs        앱 매핑/파생/폴백 스모크
scripts/phase3-endpoint-smoke.mjs endpoint 검증/변환/end-to-end 스모크
```

UI 에는 기술 용어(PIR, `motion_detected`, Firestore 등)를 노출하지 않고
`src/utils/eventPresenter.ts` 를 통해 "거실에서 활동이 확인됐어요." 같은
문장으로 변환한다.

---

## 실행 방법

```bash
npm install
cp .env.example .env     # Firebase 값 입력 (없으면 In-Memory 목업 모드)
npm start                # Expo 개발 서버 · i(iOS) / a(Android) / Expo Go QR
```

기타 스크립트:

```bash
npm run android     # Android 로 바로 실행
npm run ios          # iOS 로 바로 실행
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (expo config)
npm run test:smoke   # 순수 매핑/파생/폴백 스모크 테스트
```

**Data Source 확인:** 개발자 탭 상단에
`Firebase Firestore (영속 저장) / 실시간 구독 연결됨` 또는
`In-Memory (앱 종료 시 초기화) / 실시간 구독 미사용` 배지가 표시된다.

---

## Testing status

| 검증 | 결과 |
| --- | --- |
| `npm run typecheck` (strict) | ✅ 통과 |
| `npm run lint` | ✅ 통과 |
| `npx expo-doctor` | ✅ 21/21 |
| `npx expo export --platform android` | ✅ 번들 성공 (firebase JS SDK 포함) |
| `npm run test:smoke` | ✅ 11 + 23 통과 (앱 매핑/파생/폴백 11, endpoint 검증/변환/end-to-end 23) |
| Phase 2.5 hosted Firestore WRITE / READ / 재시작 persistence / 외부→앱 실시간 | ✅ 사용자 검증 완료 |
| Phase 3 Worker 배포 → `POST /ingest-device-event` 201 → `events` 문서 생성 → 앱 실시간 반영 | ✅ 사용자 검증 완료 |
| Phase 3 실물 PIR/ESP32 end-to-end (사람 움직임 → 앱) | ⏳ 하드웨어 도착 후 (`firmware/esp32-pir/README.md`) |

`jest-expo` 는 화면 3개 규모 대비 설정 비용이 커서 도입하지 않았다. Node 내장 TS 실행으로
순수 함수(매핑·타임스탬프·파생·폴백·endpoint 검증)를 검증하고, 화면 로직은 typecheck +
Metro 번들로 커버한다. Phase 4(자동 판단 로직)에서 규칙이 복잡해지면 jest 도입을 재검토한다.

---

## Phase 3 — ESP32 PIR Device Pipeline

### Architecture

```text
사람 움직임
  → HC-SR501 PIR
  → ESP32-S3           (상승 에지 감지 + 쿨다운, Wi-Fi)
  → HTTPS POST         { deviceId, eventType }  + X-Device-Key
  → Cloudflare Worker  /ingest-device-event
       ├─ X-Device-Key 검증
       ├─ Firestore devices/{deviceId} 조회 (존재 / enabled / type / eventType 허용)
       └─ Firestore events 문서 생성
            careRecipientId / location  ← devices 레지스트리
            source = "sensor",  payload.origin = "esp32"
            occurredAt / createdAt      ← 서버 시각 (ESP32 시계 무시)
  → Firestore events
  → onSnapshot  (앱의 단일 realtime listener, Phase 2.5 그대로)
  → careStore → Home / Timeline
  → "거실에서 활동이 확인됐어요."
```

**ESP32 는 Firestore 에 직접 쓰지 않는다.** Firebase Admin SDK / service account /
private key 를 펌웨어·앱 어디에도 넣지 않는다.

### 왜 Cloudflare Worker 인가 (비용)

- **Firebase Cloud Functions 는 2024-10 부터 배포에 Blaze(종량제) 플랜 필요** → Spark(무료)에서 불가.
- **Cloudflare Workers Free**: 하루 10만 요청, HTTPS, `*.workers.dev` 무료 도메인 → **결제 등록 없이** PoC 가능.
- Worker 는 Phase 2.5 개발용 규칙(`events` create / `devices` read 가 `if true`)에 기대어
  **Firestore REST API 를 인증 없이** 호출한다 (service account 불필요). **DEVELOPMENT ONLY.**

### Hardware List

| 부품 | 비고 |
| --- | --- |
| ESP32-S3 DevKitC-1 (N16R8 등) | USB-C **데이터** 케이블 |
| HC-SR501 PIR 모션센서 | 전원 후 ~60초 워밍업 |
| 2.4GHz Wi-Fi | ESP32 5GHz 미지원 |
| 점퍼선 3개 | |

### PIR Wiring

| HC-SR501 | ESP32-S3 |
| --- | --- |
| VCC | 5V |
| GND | GND |
| OUT | GPIO4 (`firmware/esp32-pir/config.h` 의 `PIR_PIN`) |

HC-SR501 OUT 은 ~3.3V 로짜 → ESP32-S3 3.3V 입력에 직결 가능.
피해야 할 GPIO: 0/3/45/46(스트래핑), 19/20(USB-JTAG), 26~32(플래시), 33~37(옥탈 PSRAM), 43/44(Serial).
자세한 배선·업로드·트러블슈팅: **`firmware/esp32-pir/README.md`**

### Device Registry (Firebase Console 에서 수동 생성)

Firestore 에 컬렉션 `devices`, 문서 ID `dev-device-livingroom`:

| 필드 | 값 |
| --- | --- |
| `careRecipientId` | `dev-care-recipient` (string) |
| `name` | `거실 센서` (string) |
| `type` | `ESP32_PIR` (string) |
| `location` | `거실` (string) |
| `enabled` | `true` (boolean) |

> ⚠️ **device key(`DEVICE_KEY`) 를 devices 문서에 저장하지 않는다.**
> 앱이 개발용 규칙으로 `devices` 를 read 할 수 있어 노출된다.
> 키는 Cloudflare Worker 의 secret 에만 둔다.

### Device Event API

`POST https://<worker>.workers.dev/ingest-device-event`
Headers: `Content-Type: application/json`, `X-Device-Key: <DEVICE_KEY>`
Body: `{ "deviceId": "dev-device-livingroom", "eventType": "motion_detected" }`

`eventType` 은 앱 `CareEvent.eventType` 과 **동일한 소문자 snake_case**
(`motion_detected` 등). 새 대문자 enum 없음.
전체 응답 코드/에러: **`server/cloudflare-worker/README.md`**

### 서버 배포 (사람이 직접)

```bash
cd server/cloudflare-worker
npm install
npx wrangler login                       # 무료 계정
npx wrangler secret put DEVICE_KEY       # 긴 무작위 문자열 (예: openssl rand -hex 24)
# wrangler.toml 의 FIREBASE_PROJECT_ID 확인
npx wrangler deploy                      # https://byeolileopji-ingest.<sub>.workers.dev
```

### HTTPS Test (하드웨어 없이)

```bash
curl -i -X POST "https://<worker>.workers.dev/ingest-device-event" \
  -H "Content-Type: application/json" -H "X-Device-Key: <KEY>" \
  -d '{"deviceId":"dev-device-livingroom","eventType":"motion_detected"}'
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "https://<worker>.workers.dev/ingest-device-event" `
  -ContentType "application/json" -Headers @{ "X-Device-Key" = "<KEY>" } `
  -Body '{"deviceId":"dev-device-livingroom","eventType":"motion_detected"}'
```

→ `201` + `eventId` → 앱 홈/타임라인에 몇 초 내 "거실에서 활동이 확인됐어요." 자동 표시.

### 펌웨어 (사람이 직접)

1. `firmware/esp32-pir/secrets.example.h` → `secrets.h` 로 복사, 값 채우기
   (`WIFI_*`, `DEVICE_ID`, `DEVICE_KEY`, `INGEST_URL`)
2. Arduino IDE: 보드 **ESP32S3 Dev Module**, USB CDC On Boot **Enabled**
3. `esp32-pir.ino` 업로드 → Serial Monitor 115200
4. PIR 앞에서 움직임 → `[PIR] motion detected` → `[HTTP] 201` → 앱 반영

### Security Warning (Phase 3, DEVELOPMENT / POC)

현재 PoC 는 **production-ready security 가 아니다.** 부족한 것:

- user authentication / guardian authorization
- production device identity / secure provisioning / key rotation
- rate limiting / replay protection
- Firestore 규칙이 여전히 `events` create 를 무인증 허용 (Developer Simulation 유지 목적)
- Worker 가 Firestore 에 인증 없이 write (개발용 규칙 의존)
- ESP32 HTTPS 인증서 검증 생략 (`client.setInsecure()`)

Phase 4 에서: Firebase Auth, `events` write 는 서버(service account OAuth)만,
per-device key + 서명 검증, rate limiting, CA 핀 고정.

### Validation Status

| 항목 | 상태 |
| --- | --- |
| 서버 endpoint 코드 + 검증 로직 + 스모크 테스트 | ✅ 완료 |
| ESP32 펌웨어 코드 (Wi-Fi 재연결 / 상승 에지 / 쿨다운 / 재시도) | ✅ 완료 |
| 배선 · 업로드 · 트러블슈팅 문서 | ✅ 완료 |
| Cloudflare Worker 배포 + `GET /health` | ✅ **hosted 검증 완료** |
| `X-Device-Key` 인증 + `POST /ingest-device-event` → HTTP 201 | ✅ **hosted 검증 완료** |
| `devices/dev-device-livingroom` 조회 + `events` 문서 생성 | ✅ **hosted 검증 완료** |
| Expo 앱 `onSnapshot` 실시간 반영 (endpoint 발 이벤트) | ✅ **hosted 검증 완료** |
| 실물 HC-SR501 HIGH 감지 | ⏳ 하드웨어 대기 |
| ESP32 실기기 POST / Wi-Fi 재연결 | ⏳ 하드웨어 대기 |
| 사람 움직임 → 앱 "거실에서 활동이 확인됐어요" end-to-end | ⏳ 하드웨어 대기 |

---

## 이번 Phase(3) 에서 구현하지 않은 것

로그인 UI / OAuth · Firebase Auth · 실물 하드웨어 검증 · service account 기반 서버 인증 ·
per-device key · Cloud Functions · MQTT · Galaxy Watch · Wear OS 앱 · GPS ·
푸시 알림 · 실제 복약 알림 · AI / ML · 무활동 자동 판단 · 119 자동 신고 ·
관리자 페이지 · 결제 · 여러 보호대상 전환 UI
