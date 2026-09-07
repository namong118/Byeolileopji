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
Phase 3    ✅  ESP32-S3 + PIR 센서 실연동 (하드웨어 E2E 완료)
              ├─ ✅  서버 ingest endpoint (Cloudflare Worker) — 배포 + curl → Firestore
              │       → 앱 onSnapshot 실시간 반영까지 hosted 검증 완료
              ├─ ✅  ESP32-S3 실기기 네트워크 E2E 검증 완료
              │       (실기기 업로드 → Wi-Fi → HTTPS → Worker → 인증 → Firestore → 앱 실시간)
              └─ ✅  HC-SR501 PIR → GPIO4 → ESP32 실물 센서 E2E 검증 완료
                      (사람 움직임 → 상승 에지 → handlePir() → HTTP 201 → 앱 반영. TEMP TEST/DEBUG 제거)
                      ⚠️ 장기 안정성 / 낙상 감지 / 추가 센서는 검증 범위 아님
Phase 4.0  ✅  클라이언트 상태 자동 판정 (NORMAL / CHECK / EMERGENCY)
              ├─ ✅  recent activity → NORMAL / inactivity 경과 → CHECK / sos → EMERGENCY
              ├─ ✅  ESP32 motion_detected → CHECK → NORMAL 자동 복귀 (실기기 수동 검증)
              └─ ⚠️  EMERGENCY/SOS 는 자동 테스트만 (실기기 수동 검증 전)
Phase 4.1a ✅  기기 상태 축(Device Health) 분리 + 배관 (실기기/hosted 검증 완료)
              ├─ ✅  사람 축(NORMAL/CHECK/EMERGENCY) ↔ 기기 축(online/offline/unknown) 완전 독립 — 앱 수동 검증
              ├─ ✅  Worker ingest → devices.lastEventAt best-effort 갱신 — Cloudflare 배포 + ESP32 실기기 검증
              ├─ ✅  Firestore rules (devices update = lastEventAt 만) — Console 게시 완료
              ├─ ✅  Hero 안전 규칙: 기기 offline → "오늘도 별일 없어요" 금지 — synthetic UI 수동 검증
              └─ ⚠️  heartbeat 미구현 → 실제 자동 deviceHealth 는 unknown (online/offline 자동 판정은 Phase 4.1b)
Phase 4.1b ✅  ESP32 heartbeat + /device-heartbeat → unknown → online/offline 실제 판정 (실기기 E2E 검증 완료)
              ├─ ✅  Worker `/device-heartbeat` + firestore.rules + 펌웨어 heartbeat — 구현 완료
              ├─ ✅  typecheck/lint/test:smoke(worker+rules+firmware 정적 포함) 전부 통과
              ├─ ✅  Cloudflare Worker 배포 + Firebase Console rules 게시 + ESP32-S3 실기기 업로드 완료
              ├─ ✅  ESP32 heartbeat HTTP 200 → devices.lastHeartbeatAt 실제 갱신 → 앱 online/heartbeat_fresh
              ├─ ✅  ESP32 전원 차단 → offline/heartbeat_stale ("센서 연결을 확인하고 있어요") → 재연결 → online 자동 복귀
              └─ ✅  사람 축(NORMAL/CHECK) ↔ 기기 축(online/offline) 실기기에서 독립 동작 확인
                      (PIR 실물 센서 E2E 는 Phase 3 에서 별도 완료)
Home UX A–D ✅  보호자 홈 화면 정보구조 압축 (판정 로직·개발자 탭 무변경, 실기기 UX 검증 완료)
              ├─ ✅  홈 = Hero + 통합 정보 카드(마지막 활동 / 센서 연결 / 오늘 활동) + 오늘의 기록
              ├─ ✅  복약·워치·평상시 SOS·외출/귀가·중복 offline 경고·별도 offline 문장 홈에서 제거
              ├─ ✅  오전/오후 12시간 표기 통일 · "오늘 활동" = 생활 움직임(모션/문/외출/귀가) 전용 집계
              └─ ✅  날짜 경계(자정 넘김) 실기기 확인 — 전날 lastActivity 유지 / 당일 활동·기록 0건 독립 표시
Phase 4.3  🚧  Cloudflare cron + 서버측 상태 판정 (careStatus 문서)
              ├─ ✅  STEP A — 서버 재사용 가능한 순수 판정 코어 `computeCareStatusSnapshot`
              │       (deriveCareStatus + deriveDeviceHealth 조합, threshold 주입, now 주입,
              │        client↔server parity 스모크, Firestore write·cron·deploy 없음)
              ├─ ✅  STEP B-1 — Firestore READ → normalize → 공유 코어 compute
              │       (Worker `firestoreRead.js` + `careStatusReader.js`, events `:runQuery`
              │        + devices point read, **READ ONLY**, 실제 dev Firestore READ 검증 완료)
              ├─ ✅  STEP B-2 — careStatus 스냅샷 스키마 + Firestore write (serialize 순수 분리,
              │       `careStatus/{careRecipientId}` deterministic overwrite, 실패 = throw,
              │       스모크 13건. 운영 threshold 확정 · 실제 write 검증은 rules 게시 후)
              ├─ ⏳  STEP B-3 — 이전 스냅샷 비교 → 상태 전환 감지
              └─ ⏳  STEP B-4 — `wrangler.toml` cron + `scheduled()` deploy
Phase 4.4  ⏳  FCM 푸시 + Firebase Auth + Firestore rules 좁히기
Phase 5    ⏳  복약 관리 + 스마트워치 Mock 통합
```

> **Phase 2 → 2.5 전환:** Supabase 연동 코드를 작성했으나 hosted 검증 전
> **Firebase Firestore 로 백엔드를 전환**했다. Supabase 코드는 제거됨 (git `c8392af`).
> Phase 2.5 의 hosted Firestore WRITE / READ / 재시작 persistence / 외부 문서 → 앱 실시간
> 반영은 **실제로 검증 완료**.
>
> **Phase 3 현황:** ESP32 가 Firestore 에 직접 쓰지 않고
> `ESP32 → HTTPS → Cloudflare Worker → Firestore` 구조.
>
> **✅ 하드웨어 E2E 검증 완료** (실물 HC-SR501 로 확인):
> 사람 움직임 → HC-SR501 PIR → `GPIO4` 상승 에지 → `handlePir()` → ESP32-S3 → 2.4GHz Wi-Fi →
> Cloudflare Worker HTTPS POST → `X-Device-Key` 인증 → `POST /ingest-device-event` HTTP 201 →
> `events` 문서 생성 → `devices.lastEventAt` 갱신 → Expo 앱 `onSnapshot` 실시간 반영
> ("활동이 확인됐어요"). 쿨다운(`MOTION_COOLDOWN_MS`) 동작도 확인.
> 초기 검증에 쓴 부팅 TEMP TEST 블록과 GPIO4 TEMP DEBUG 는 **제거**했다
> (`scripts/firmware-check.mjs` 가 재유입 차단).
>
> ⚠️ 단일 세션 E2E 까지 확인. 장기 안정성 / 낙상 감지 / 추가 센서는 아직 범위 아님.
> (상세: `firmware/esp32-pir/README.md`)

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
| `npx expo-doctor` | ⚠️ 20/21 (`expo` 57.0.19 / `expo-router` 57.0.18 이 SDK 핀 `~57.0.20` / `~57.0.19` 과 패치 버전 불일치 — 이번 작업과 무관한 기존 이슈, 의존성 변경 안 함, 별도 `npx expo install --check` 대상) |
| `npx expo export --platform android` | ✅ 번들 성공 (firebase JS SDK 포함) |
| `npm run test:smoke` | ✅ 11 + 38 + 15 + 30 + 23 + 18 + 13 + 7 + 12 = 167 통과 (앱 매핑 11, Worker ingest+heartbeat 38, 사람 축 15, 기기 축 + 홈 표시 30, 서버 판정 코어 + parity 23, 서버 Firestore READ adapter 18, 서버 careStatus snapshot serialize+write 13, rules 정적 7, firmware 정적 12) |
| Phase 2.5 hosted Firestore WRITE / READ / 재시작 persistence / 외부→앱 실시간 | ✅ 사용자 검증 완료 |
| Phase 3 Worker 배포 → `POST /ingest-device-event` 201 → `events` 문서 생성 → 앱 실시간 반영 | ✅ 사용자 검증 완료 |
| Phase 3 **ESP32-S3 실기기** 네트워크 E2E (실기기 → Wi-Fi → Worker → 인증 → Firestore → 앱) | ✅ 사용자 검증 완료 |
| Phase 3 **실물 PIR** (사람 움직임 → HC-SR501 → GPIO4 상승 에지 → `handlePir()` → HTTP 201 → 앱 반영, 쿨다운 포함) | ✅ **실물 센서 E2E 검증 완료** · TEMP TEST/DEBUG 제거 · ⚠️ 장기 안정성·낙상 감지·추가 센서는 범위 아님 (`firmware/esp32-pir/README.md`) |
| **Phase 4.0** recent activity → NORMAL / inactivity 경과 → CHECK / ESP32 motion → CHECK→NORMAL 자동 복귀 | ✅ **실기기 수동 검증 완료** (개발용 2분 threshold) |
| **Phase 4.0** EMERGENCY / SOS 판정 · override · TTL · ack | ✅ 자동 스모크 15건 · ⚠️ 실기기 수동 검증은 미실시 |
| **Phase 4.1a** 사람 축 / 기기 축 독립 · deriveDeviceHealth · presentHome 안전 규칙 | ✅ 자동 스모크 12건 |
| **Phase 4.1a** 개발자 오버라이드 `offline` → Hero 가 초록 "오늘도 별일 없어요" 대신 중립 문구 | ✅ **앱 수동 검증 완료** |
| **Phase 4.1a** `자동으로` 복귀 → 사람 축 CHECK 상태 다시 노출 / 새 motion → CHECK→NORMAL 복귀 | ✅ **앱 수동 검증 완료** |
| **Phase 4.1a** Worker ingest → devices.lastEventAt best-effort PATCH (실패해도 201) | ✅ 자동 스모크 2건 · ✅ **Cloudflare 배포 + ESP32-S3 실기기 hosted 검증 완료** |
| **Phase 4.1a** Firestore rules (`devices` update = `lastEventAt` 만) | ✅ **Firebase Console 게시 완료** · ⚠️ 자동 유닛 테스트는 미실시 (에뮬레이터/Java 없음 → 정적 구조 검사 `rules-check.mjs` 6건 + Console Playground 수동) |
| **Phase 4.1a** 실제 자동 device online/offline 판정 | ⏳ heartbeat 미구현 → Phase 4.1b |
| **Phase 4.1b** Worker `/device-heartbeat` (인증/검증/lastHeartbeatAt PATCH/events 미생성/write 실패 5xx) | ✅ 자동 스모크 13건 (fetch mock) · ✅ **Cloudflare 배포 + ESP32-S3 실기기 hosted 검증 완료** (HTTP 200) |
| **Phase 4.1b** 기존 `/ingest-device-event` · `/health` 회귀 | ✅ 자동 스모크로 재확인 (동일 응답) |
| **Phase 4.1b** `deriveDeviceHealth` heartbeat fresh→online / stale→offline / CHECK+online→CHECK UI | ✅ 자동 스모크 2건 (synthetic) · ✅ **실기기에서 online→offline→online 왕복 확인** |
| **Phase 4.1b** `firestore.rules` devices update = `hasOnly(['lastEventAt','lastHeartbeatAt'])` | ✅ 코드 반영 + 정적 검사 6건 · ✅ **Firebase Console 게시 완료** |
| **Phase 4.1b** 펌웨어 heartbeat (`sendHeartbeat`/`handleHeartbeat`, motion 경로 유지) | ✅ 정적 검사 12건 + xtensa-esp-elf-g++ 구문 검사 · ✅ **ESP32-S3 실기기 업로드 + `[HB] 200` 확인** |
| **Phase 4.1b** 실기기 heartbeat E2E (heartbeat 로 online 유지 → 전원 차단 시 offline → 재연결 시 online) | ✅ **사용자 실기기 검증 완료** (테스트값: heartbeat 30초 / offline 임계 2분 / recompute 15초 — 전부 원복) |
| **Phase 4.1b** 사람 축 CHECK 와 기기 축 offline 이 홈에서 혼동되지 않음 (CHECK ≠ 센서 offline) | ✅ **실기기 검증 완료** (전원 차단 시 "센서 연결을 확인하고 있어요" 로 정확히 전환) |
| **Phase 4.1b** HC-SR501 PIR 실물 센서 → GPIO4 → heartbeat 와 병행 E2E | ✅ **실물 센서 E2E 검증 완료** (Phase 3 항목 참고. PIR motion + heartbeat 가 같은 펌웨어에서 병행 동작) |

`jest-expo` 는 화면 3개 규모 대비 설정 비용이 커서 도입하지 않았다. Node 내장 TS 실행으로
순수 함수(매핑·타임스탬프·파생·폴백·endpoint 검증·상태 판정·기기 판정)를 검증하고,
화면 로직은 typecheck + Metro 번들로 커버한다. 규칙이 더 복잡해지면 jest 도입을 재검토한다.

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
| **ESP32-S3 DevKitC-1 실기기** 펌웨어 업로드 | ✅ **실기기 검증 완료** |
| **ESP32-S3 → 2.4GHz Wi-Fi 연결** | ✅ **실기기 검증 완료** |
| **ESP32-S3 → Worker HTTPS POST + `X-Device-Key` 인증 → HTTP 201** | ✅ **실기기 검증 완료** |
| **ESP32-S3 발 이벤트 → Firestore → Expo 앱 실시간 반영** ("방금 · 거실") | ✅ **실기기 검증 완료** |
| 실물 HC-SR501 PIR HIGH 감지 (GPIO4 상승 에지) | ✅ **실기기 검증 완료** (`[PIR DEBUG] transition LOW -> HIGH` 로 배선 확인 후 제거) |
| 사람 움직임 → HC-SR501 → GPIO4 → `handlePir()` → HTTP 201 → 앱 "활동이 확인됐어요" end-to-end | ✅ **실기기 검증 완료** (쿨다운 동작 포함) |

---

## Phase 4.0 — 클라이언트 상태 자동 판정

앱이 최근 생활 이벤트를 기반으로 현재 상태를 스스로 판정한다.
Firestore 스키마 변경 없음, 새 컬렉션 없음, Worker/firmware/rules 변경 없음.

### 판정 규칙 (`src/services/careStatus.ts` — 순수 함수)

입력: `lastActivityAt` · `lastSosAt` · `totalEventCount` · `config` · `now`
(이벤트 스캔은 `src/services/eventViews.ts`)

| 우선순위 | 조건 | 결과 |
| --- | --- | --- |
| 1 | 최근 `sos_triggered` (lookback 내 · TTL 내 · 미확인) | `EMERGENCY` / reason `sos` |
| 2 | 이벤트 0건 또는 활동 이벤트 없음 | `NORMAL` / reason `no_data` |
| 3 | 마지막 활동 이후 `inactivityCheckMinutes` 초과 | `CHECK` / reason `inactivity` |
| 4 | 그 외 | `NORMAL` / reason `recent_activity` |

- `systemHealth` = **사람 데이터 가용성** (기기 상태 아님 — 기기는 Phase 4.1a 의 Device Health 축):
  이벤트 0건 → `unknown`, 그 외 → `ok`
- **EMERGENCY 는 새 `motion_detected` 로 자동 해제되지 않는다** (규칙 1 최우선).
- **CHECK → NORMAL 복귀**: 새 활동 이벤트가 `lastActivityAt` 을 갱신 → onSnapshot → 즉시.
- 개발자 화면의 상태 버튼 = **임시 오버라이드**(TTL 有). 만료되면 자동 판정으로 복귀.

### 화면 문구 (`src/utils/careStatusText.ts`)

| status / reason | 색 톤 | headline | 예시 detail |
| --- | --- | --- | --- |
| NORMAL / `recent_activity` | 🟢 초록 | 오늘도 별일 없어요 | "12분 전에 활동이 확인됐어요." |
| CHECK / `inactivity` | 🟡 노랑 | 한번 확인해 주세요 | "약 2시간째 활동이 확인되지 않았어요." |
| EMERGENCY / `sos` | 🔴 빨강 | 도움이 필요할 수 있어요 | "오후 3:20에 도움 요청이 있었어요." |
| NORMAL / `no_data` | ⚪ **중립(회색)** | **아직 활동 정보가 없어요** | "활동 기록이 들어오면 여기에서 확인할 수 있어요." |
| (기기 offline, Phase 4.1a) | ⚪ 중립 | 센서 연결을 확인하고 있어요 | "마지막 활동은 …에 있었어요." |

> ⚠️ **이벤트가 없거나(`no_data`) 기기(센서) 가 offline 인 경우, 화면에 "오늘도 별일 없어요"
> 처럼 활동이 정상 확인됐다는 문구를 절대 쓰지 않는다.** 내부 status 는 호환성을 위해
> NORMAL 이지만, 화면은 중립 문구 + 중립 색을 쓴다.

### 임계값 (`src/config/careStatusConfig.ts`)

| 설정 | 기본값 | 환경변수 |
| --- | --- | --- |
| inactivity → CHECK | **180분** | `EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES` |
| sos lookback | 12시간 | `EXPO_PUBLIC_EMERGENCY_LOOKBACK_HOURS` |
| sos TTL (자동 만료) | 12시간 | `EXPO_PUBLIC_EMERGENCY_TTL_HOURS` |
| 재계산 주기 | 30초 | `EXPO_PUBLIC_STATUS_RECOMPUTE_INTERVAL_MS` |
| 오버라이드 TTL | 10분 | `EXPO_PUBLIC_STATUS_OVERRIDE_TTL_MS` |

> ⚠️ **위 기본값은 전부 PoC / 개발용 placeholder 이며 실제 안전 기준이 아니다.**
> 실제 무활동 판정 시간은 수면·외출·센서 위치·생활 패턴 데이터를 확보한 뒤
> (Phase 4.1+ 의 per-보호대상 설정 / 시간대 프로파일로) 확정한다.

### 실시간 갱신

`careStore` 가 다음을 모두 같은 `project()` 로 통과시킨다:
최초 로딩 · 수동 새로고침 · Firestore `onSnapshot` · **저빈도 타이머(기본 30초)** ·
**앱 포그라운드 복귀(AppState active)**.
타이머 재계산은 **메모리상 이벤트로만** 하며 Firestore read/write 를 발생시키지 않는다.
→ 이벤트가 없어도 시간 경과만으로 NORMAL → CHECK 전환이 일어난다.

### 실기기 수동 검증 완료 (사용자, 개발용 2분 threshold)

```
최근 motion_detected 있음                  → NORMAL 정상 표시
약 2분간 활동 없음                          → 자동으로 CHECK 전환 (확인 필요 UI)
CHECK 상태에서 HC-SR501 앞에서 실제 움직임   → handlePir() 상승 에지 → motion_detected
ESP32 → Wi-Fi → Worker → Firestore → onSnapshot
앱 조작/새로고침 없이 CHECK → NORMAL 자동 복귀 → 활동 확인 UI 정상 표시
```
(초기에는 부팅 TEMP TEST 이벤트로 확인했고, PIR 실물 연결 후 실제 움직임으로 재확인.)

- 개발용 2분 threshold 는 **테스트 설정일 뿐 실제 안전 기준이 아니다.**
- EMERGENCY / SOS 경로는 **자동 스모크 15건만** 완료. 실기기 수동 검증은 아직 안 했다.
- ESP32 RESET 버튼으로는 Serial 로그가 안 보였고 USB 재연결 재부팅으로 검증했다.
  RESET 버튼 이슈는 Phase 4.0 상태 판정과 무관하며 별도 항목으로 둔다.

### Phase 4.0 에서 구현하지 않은 것

기기 상태 축 · ESP32 heartbeat · Cloudflare cron · 서버측 상태 판정 · `careStatus` 문서 ·
FCM 푸시 · Firebase Auth · Firestore rules 강화 · events enum 변경 → 전부 Phase 4.1 이후.

---

## Phase 4.1a — 기기 상태 축(Device Health) 분리

**사람 상태**와 **기기(센서/ESP32) 상태**를 완전히 독립된 두 축으로 만든다.
두 enum 을 절대 합치지 않고, 표시 경계(`presentHome`)에서만 조합해 Hero 문구 1개를 만든다.

```
사람 축  deriveCareStatus()   → NORMAL / CHECK / EMERGENCY   (+ reason)
기기 축  deriveDeviceHealth() → online / offline / unknown   (+ reason)
              ↓ 스토어에 별도 필드 (careStatus / deviceHealth)
         presentHome(사람, 기기)  → Hero 톤/이모지/문구 1개
```

### 왜 4.1a 에서는 항상 `unknown` 인가

제안됐던 "ingest 시 `lastSeenAt` 갱신"은 `motion_detected` 같은 이벤트가 있어야만 갱신된다.
→ 사람이 오래 가만히 있고 ESP32 는 정상인데 이벤트가 없어 `lastSeenAt` 이 오래되면
**멀쩡한 센서를 offline 으로 오판**할 수 있다.

그래서 두 신호를 분리한다:

| 필드 | 의미 | 갱신 |
| --- | --- | --- |
| `devices/{id}.lastEventAt` | 마지막 이벤트가 서버에 도착한 시각 (**사람** 신호) | Worker 가 `/ingest-device-event` 성공 시 (4.1a) |
| `devices/{id}.lastHeartbeatAt` | ESP32 가 살아있고 통신 가능함을 확인한 시각 (**기기** 신호) | `/device-heartbeat` (Phase 4.1b) |

**`deriveDeviceHealth` 규칙:** `lastHeartbeatAt` 이 없으면(=heartbeat 신호 없음) → **항상 `unknown`**.
`lastEventAt` 이 아무리 오래돼도 offline 으로 판정하지 않는다.
`online`/`offline` 은 `lastHeartbeatAt` 이 주어진 **synthetic/unit test 에서만** 나온다.
실제 online/offline 판정은 **Phase 4.1b** (ESP32 heartbeat + `/device-heartbeat`)에서 활성화된다.

| deviceDoc | lastHeartbeatAt | 결과 |
| --- | --- | --- |
| 없음 | — | `unknown` / `no_device_doc` |
| 있음 | 없음 (4.1a 는 항상 이 상태) | `unknown` / `no_heartbeat_capability` |
| 있음 | ≤ `deviceOfflineMinutes` (기본 25분) | `online` / `heartbeat_fresh` (4.1b) |
| 있음 | > `deviceOfflineMinutes` | `offline` / `heartbeat_stale` (4.1b) |

### Hero 안전 규칙 (`presentHome`)

1. `EMERGENCY` → 기기 상태와 무관하게 EMERGENCY Hero (최우선)
2. `deviceHealth === 'offline'` → **절대 "오늘도 별일 없어요" 초록 Hero 금지.**
   중립 "센서 연결을 확인하고 있어요" + 별도 안내(`Notice`)
3. `deviceHealth === 'unknown'` → **장애가 아니다.** 우리가 받은 이벤트를 무효화하지 않는다.
   최근 `motion_detected` 가 있으면 기존 NORMAL Hero 그대로.
4. `deviceHealth === 'online'` → 기존 4.0 Hero 그대로

> Phase 4.1a 실제 데이터에서는 2번(offline)이 나오지 않는다. 코드/유닛 테스트로만 존재한다.

### Firestore

- **새 컬렉션 없음.** `devices/{deviceId}` 에 `lastEventAt` 필드만 추가 (Worker 가 씀).
- **`firestore.rules` 변경 (⚠️ DEVELOPMENT ONLY):**
  `devices` 에 **`lastEventAt` 한 필드만** 갱신 허용:
  ```
  allow update: if request.resource.data.diff(resource.data)
                    .affectedKeys().hasOnly(['lastEventAt']);
  ```
  핵심 레지스트리 필드(`careRecipientId` / `enabled` / `type` / `location` / `name`)는
  클라이언트가 변경할 수 없다. 실제 버전에서는 Worker 가 service-account 인증 → 이 규칙 제거.
- **배포 상태**: 위 규칙을 **Firebase Console 에 실제 게시 완료** (사용자, Phase 4.1a).
- **Rules 검증**: 이 개발 환경에 Java/firebase-tools/에뮬레이터가 없어
  `@firebase/rules-unit-testing` 자동 테스트는 미실시. 정적 구조 검사(`scripts/rules-check.mjs`,
  6건)만 수행. 의미 검증은 Console Playground 수동 절차 (아래).

  **Console Rules Playground 수동 확인** (Firebase Console > Firestore > 규칙 > Playground):
  1. `Update` · 경로 `/devices/dev-device-livingroom` · 인증 없음 ·
     문서 `{ lastEventAt: <아무 timestamp> }` → **허용(Allow)** 이어야 함
  2. 같은 조건 · 문서 `{ enabled: false }` → **거부(Deny)** 이어야 함
  3. 같은 조건 · 문서 `{ lastEventAt: <ts>, name: "해킹" }` → **거부** 이어야 함
  4. `Get` · `/devices/dev-device-livingroom` · 인증 없음 → **허용**

### Worker

- `firestore.js`: `touchDevice(env, deviceId, fields)` 추가 — `PATCH devices/{id}?updateMask.fieldPaths=…`
- `index.js`: `createEvent` **성공 후** `touchDevice(env, deviceId, { lastEventAt: <서버 시각> })` 를
  **best-effort** 로 호출. **실패해도 이미 성공한 ingest 를 실패로 만들지 않는다 — 201 유지.**
- `X-Device-Key` 인증 / `validateRequest` / `validateDevice` / `buildEventDoc` — **무변경.**

### 앱

- `src/services/deviceHealth.ts` (신규, 순수) · `src/types/device.ts` (신규) ·
  `src/services/firestore/deviceRepository.ts` (신규 — `devices/{id}` onSnapshot 구독)
- `careStore`: `deviceHealth` / `deviceDoc` / `deviceHealthOverride` 상태, `project()` 가
  사람·기기 두 축을 독립 계산, device 구독을 최초 1회, `teardown()` 에서 해제
- 개발자 탭: **Care Status (사람 축)** / **Device Health (기기 축)** 두 read-out 카드 +
  기기 축 임시 오버라이드 버튼(`online`/`offline`/`unknown`/`자동으로`)
- 홈: 기기 `offline` 일 때만 `Notice` (4.1a 실제 데이터에선 안 나옴)

### 실기기/hosted 수동 검증 완료 (사용자)

**[앱 UI — 두 축 분리]**
1. 개발자 탭 **Device Health** 구조 정상 노출 (`derived health = unknown` / `no_heartbeat_capability` — 4.1a 정상)
2. 개발자 오버라이드 `[offline]` → 홈 Hero 가 초록 "오늘도 별일 없어요" 가 **아니라**
   중립 "센서 연결을 확인하고 있어요" 로 전환됨
3. `[자동으로]` 복귀 → 사람 축이 CHECK 였으므로 다시 "확인해 주세요" 계열 UI 노출
4. 새 `motion_detected` → 사람 축 CHECK → NORMAL → "오늘도 별일 없어요" 정상 복귀
   → **사람 축 / 기기 축의 표시 우선순위·분리가 실제 앱에서 검증됨**

**[Firestore Rules]**
- Firebase Console 에 `devices` 규칙 실제 게시. `update` 는 `hasOnly(['lastEventAt'])` 만,
  `create`/`delete` 금지, 핵심 필드 변경 불가.

**[Worker hosted — lastEventAt]**
- Phase 4.1a Worker 변경을 Cloudflare 에 실제 배포.
- (당시 검증) ESP32-S3 재부팅 → 부팅 TEMP TEST 의 `motion_detected` 1회 전송 →
  (Phase 3 에서 PIR 실물 움직임으로 동일 경로 재확인, TEMP TEST 는 이후 제거)
  - ESP32 → Wi-Fi → Worker `/ingest-device-event` 기존 흐름 정상
  - `events` 문서 생성 성공
  - **`devices/dev-device-livingroom.lastEventAt` timestamp 필드가 실제로 생성/갱신됨**
  - 앱에 활동 이벤트 실시간 반영도 기존처럼 정상
  → **`ESP32-S3 → Worker ingest → events 생성 → devices.lastEventAt best-effort update → 앱 실시간 반영` 실제 검증 완료**

**[아직 pending]**
- heartbeat 미구현 → `lastHeartbeatAt` 필드/쓰기 없음 → 실제 자동 `deviceHealth` 는
  항상 `unknown / no_heartbeat_capability` (정상). 실제 `online`/`offline` **자동** 판정은 Phase 4.1b.
- `online`/`offline` 은 현재 synthetic(unit test) + 개발자 오버라이드로만 확인됨.

---

## Phase 4.1b — ESP32 Heartbeat (구현 + 실기기 E2E 검증 완료)

`deviceHealth` 를 `unknown` → 실제 `online`/`offline` 로 전환한다. Phase 4.1a 의 판정 구조
(`deriveDeviceHealth`, `presentHome`, 두 축 분리)를 그대로 재사용하며 앱 로직은 **한 줄도
바뀌지 않았다** — heartbeat 데이터가 채워지는 순간 자동으로 online/offline 판정이 시작된다.

> ✅ **Cloudflare Worker 배포 · Firebase Console `firestore.rules` 게시 · ESP32-S3 실기기 업로드
> 모두 완료했고, 아래 "실기기 E2E 검증 완료" 절차대로 online → offline → online 왕복을
> 실물 하드웨어로 확인했다.**  (HC-SR501 PIR 실물 센서 E2E 는 Phase 3 에서 별도 완료.)

### Heartbeat 정책

- **필수 필드는 `lastHeartbeatAt` 하나뿐.** `lastBootAt`/`lastReason`/RSSI 등은 YAGNI 로 이번엔 추가하지 않았다.
- heartbeat 는 `events` 컬렉션에 문서를 만들지 않는다. `devices/{deviceId}` 상태 필드만 갱신.
- 기본값(전부 `config.h`/env 로 조정 가능):

| 값 | 기본 | 조정 |
| --- | --- | --- |
| heartbeat 주기 | 10분 | 펌웨어 `config.h` `HEARTBEAT_INTERVAL_MS` |
| 기기 offline 임계 | 25분 | 앱 `EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES` |

> 실기기 검증 시엔 `HEARTBEAT_INTERVAL_MS`(config.h) 를 `30000UL`(30초) 정도로,
> `EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES`(.env) 를 `2` 정도로 **로컬에서만** 바꿔 빠르게 확인하고,
> **커밋하지 않는다.** 실사용 기본값(10분/25분)은 그대로 코드에 남긴다.

### Worker `POST /device-heartbeat`

- 인증은 기존 `X-Device-Key` **그대로** 재사용 (`DEVICE_KEY` 구조 무변경).
- 검증은 새 `validateHeartbeatRequest`/`validateHeartbeatDevice` (작은 별도 함수 —
  기존 `validateRequest`/`validateDevice` 의 eventType 의미를 억지로 맞추지 않음).
- 성공: `devices/{deviceId}.lastHeartbeatAt` = 서버 시각, **`events` 미생성**, `200 OK`.
- **best-effort 아님**: `lastHeartbeatAt` 갱신 실패 시 `502`/`500` (ingest 의 `lastEventAt` 은
  best-effort 였지만, heartbeat 는 갱신 자체가 목적이므로 실패를 성공으로 위장하지 않는다).
- `touchDevice()` 재사용 (Phase 4.1a 헬퍼, 변경 없음) — `{ lastHeartbeatAt: Date }` 로 호출.
- `/health`, `/ingest-device-event` 응답/동작 **불변** (스모크로 재확인).

### Firestore rules (코드 반영 + Console 게시 완료)

```
allow update: if request.resource.data.diff(resource.data)
                  .affectedKeys().hasOnly(['lastEventAt', 'lastHeartbeatAt']);
```

`careRecipientId`/`enabled`/`type`/`location`/`name` 여전히 변경 불가. `create`/`delete` 금지 유지.
**✅ Firebase Console 에 실제 재게시 완료** — heartbeat 가 `devices/{id}.lastHeartbeatAt` 을
정상적으로 PATCH 하는 것을 실기기로 확인했다. (게시 전이었다면 heartbeat 는 best-effort 가
아니므로 `firestore_write_failed`(502) 로 명확히 실패했을 것이다.)

### 펌웨어 (`esp32-pir.ino`, 전부 additive)

- 신규: `sendHeartbeat()`(POST, 최대 2회 재시도), `handleHeartbeat()`(millis 기반 non-blocking)
- 전송 시점: **A)** 부팅 후 Wi-Fi 연결 시 1회, **B)** 이후 `HEARTBEAT_INTERVAL_MS` 마다,
  **C)** Wi-Fi 재연결 시 즉시 (busy-loop 없음, 무한 재시도 없음)
- `loop()` 에 `handleHeartbeat();` 한 줄 추가한 것 외 **`wifiConnect()`/`handlePir()`/`postEvent()`/
  `setup()` 은 그대로.** (당시 유지했던 부팅 TEMP TEST 는 Phase 3 PIR 실물 E2E 완료 후 제거.)
- motion 과 heartbeat 는 의미상 분리(사람 신호 vs 기기 신호)만 하고, coalescing(motion 있으면
  heartbeat 생략) 같은 최적화는 이번 단계에서 하지 않았다 — 필요하면 향후 최적화 대상.

### 앱

- **변경 없음.** `deriveDeviceHealth`(4.1a) 가 이미 `lastHeartbeatAt` 을 받아 online/offline 을
  판정하도록 작성돼 있었고, `deviceRepository.ts` 도 이미 그 필드를 매핑한다.
- heartbeat 가 들어오기 시작하면: `lastHeartbeatAt` 신선(≤25분) → `online` / 초과 → `offline`.
- 안전 규칙 그대로 유지: EMERGENCY 최우선, 기기 offline 이면 "오늘도 별일 없어요" 금지,
  **사람 CHECK + 기기 online** 은 정상적으로 "한번 확인해 주세요" (CHECK ≠ 센서 offline).

### 실기기 E2E 검증 완료 (사용자)

배포: **Cloudflare Worker `npx wrangler deploy` 완료** · **Firebase Console `firestore.rules`
재게시 완료** · **ESP32-S3 DevKitC-1 에 Phase 4.1b 펌웨어 업로드 완료** · `secrets.h` 에
`HEARTBEAT_URL` 추가 (사용자 직접, git 무시됨).

검증 시 임시로 `HEARTBEAT_INTERVAL_MS` 30초 / `EXPO_PUBLIC_DEVICE_OFFLINE_MINUTES` 2분 /
`EXPO_PUBLIC_STATUS_RECOMPUTE_INTERVAL_MS` 15초 로 낮춰 빠르게 관찰한 뒤 **세 값 모두 원복**
(코드 기본값 heartbeat 10분 / offline 25분 유지, `.env` 는 커밋 안 함).

**[heartbeat 정상 경로]**
1. ESP32-S3 → `POST /device-heartbeat` → **HTTP 200** (`[HB] 200 {"ok":true,...}`)
2. Firebase Console `devices/dev-device-livingroom.lastHeartbeatAt` **필드 실제 생성/갱신 확인**
3. 별일없지 앱 개발자 탭 > Device Health → **`derived health = online` / `reason = heartbeat_fresh`**

**[online → offline → online 왕복]**
4. ESP32-S3 USB 전원 분리 → heartbeat 중단
5. offline 임계(테스트값 2분) 경과 → 앱이 **`offline` / `heartbeat_stale`** 로 자동 전환
   → 홈 Hero 가 **"센서 연결을 확인하고 있어요"** 로 표시 (사람 축이 아니라 기기 축 문구)
6. ESP32-S3 USB 재연결 → heartbeat 재개 → **`online` / `heartbeat_fresh` 자동 복귀**
   → **`ONLINE → 전원 차단 → OFFLINE → 재연결 → ONLINE` 왕복 E2E 실기기 검증 완료**

**[사람 축 / 기기 축 독립 — 실기기 확인]**
7. 기기 축이 `online`/`offline` 로 바뀌는 동안 사람 축(`NORMAL`/`CHECK`)은 별개로 계산됨.
   기기 offline 이어도 사람 축 문구가 "오늘도 별일 없어요" 로 오염되지 않고,
   기기 online 이어도 사람 CHECK 는 "한번 확인해 주세요" 로 정상 표시됨 (`CHECK ≠ 센서 offline`).

**[PIR 실물 E2E — Phase 3 에서 완료]**
- **HC-SR501 PIR 실물 센서 → GPIO4 상승 에지 → `handlePir()` → HTTP 201 → 앱 반영** 검증 완료.
  (GPIO4 진단용 TEMP DEBUG 로 `LOW -> HIGH` transition 확인 후, 실제 움직임으로 E2E 확인.)
- 검증 후 `setup()` 의 부팅 TEMP TEST 블록과 GPIO4 TEMP DEBUG 를 **모두 제거**했다
  (`scripts/firmware-check.mjs` 가 재유입 차단, 정적 검사 12건).
- 장기 안정성 / 낙상 감지 / 추가 센서는 아직 범위 아님.

---

## Guardian Home UX (A–D) — 보호자 홈 화면 정리

Phase 4.1b 까지로 사람 축 / 기기 축 판정과 실기기 파이프라인이 완성된 뒤,
**앱 홈 화면만** 보호자가 "지금 별일 없나?" 를 1~2초에 이해하도록 압축했다.
판정 로직(`careStore` / `careStatus` / `deviceHealth` / `presentHome`)·개발자 탭·
서버·펌웨어는 **한 줄도 바뀌지 않았다.** 화면 조립과 표시 문구만 정리했다.

### 무엇을 바꿨나

| 구분 | 이전 | 이후 |
| --- | --- | --- |
| 홈 정보구조 | Hero + pairRow + "오늘의 상태" 카드(5행: 생활활동/외출귀가/복약/워치/SOS) + 타임라인 | Hero + **통합 정보 카드(마지막 활동 / 센서 연결 / 오늘 활동)** + 타임라인 |
| 복약·워치·평상시 SOS 행 | 홈에 표시 | **홈에서 제거** (개발자 탭 시뮬레이션·이벤트 타입은 유지) |
| 외출/귀가 | pairRow 로 표시 | 홈 미표시 (`homeSummary` 계산·타입은 유지) |
| 기기 offline | 빨간 `Notice` + Hero 문구 + Hero 아래 회색 문장 (3중) | Hero(중립) + 정보 카드 "센서 연결 / 신호가 끊겼어요" (2곳). 빨간 경고·별도 문장 제거 |
| "마지막 활동" 표기 | `오후 3:12 · 거실` (절대시각, 두 곳 중복) | `3시간 12분 전 · 거실` (상대시간, 정보 카드 1곳) |
| 시각 표기 | 홈 `오후 3:12` / 타임라인 `15:12` 혼재 | **전부 `오전/오후` 12시간** (`formatClock`) |
| "오늘 활동 N번" | 없음 → STEP C 에서 `ACTIVITY_EVENT_TYPES`(복약·워치 포함) | `DAILY_LIVING_ACTIVITY_EVENT_TYPES` = 모션/문/외출/귀가 **생활 움직임만** |

### "오늘 활동" 집계 분류가 왜 별도인가

- `src/services/eventViews.ts` 의 `ACTIVITY_EVENT_TYPES` (**변경 없음**) — "마지막 활동" 판정과
  `careStatus` inactivity 판정용. 넓은 의미의 "사람이 뭔가 했다" 신호(복약·워치 포함).
- `src/utils/todayActivity.ts` 의 `DAILY_LIVING_ACTIVITY_EVENT_TYPES` (**신규**) — 홈 "오늘 활동 N번"
  카운트 전용. 보호자가 "생활 움직임 횟수" 로 읽으므로 물리적 동선(`motion_detected` /
  `door_opened` / `returned_home` / `left_home`)만. `medication_taken` / `watch_activity` 는 제외.
- 이 분리는 **오늘 활동 요약 숫자에만** 영향을 준다. 마지막 활동 판정 / inactivity 판정 /
  타임라인 분류 / 이벤트 의미는 그대로다. (`scripts/phase41-devicehealth-smoke.mjs` 13e~13g 로 고정)

### 상태별 홈 (요약)

| 상태 | Hero | 정보 카드 |
| --- | --- | --- |
| NORMAL | 🟢 오늘도 별일 없어요 / "12분 전에 활동이 확인됐어요." | 마지막 활동 `12분 전 · 거실` · 센서 연결 `정상` · 오늘 활동 `8번 · …` |
| CHECK + online | 🟡 한번 확인해 주세요 / "약 3시간째 활동이 확인되지 않았어요." | 센서 연결 `정상 · 신호는 계속 오고 있어요` — **"센서는 정상, 사람이 조용함" 구분** |
| DEVICE OFFLINE | ⚪ 센서 연결을 확인하고 있어요 (중립, `presentHome` 규칙2) | 센서 연결 `신호가 끊겼어요` — "사람에게 문제" 해석 문구 없음 |
| EMERGENCY | 🔴 도움이 필요할 수 있어요 (`presentHome` 규칙1, 기기 무관 최우선) | 정보 카드는 종속 정보, Hero 보다 약함 |

### 실기기 UX 검증 (사용자, Android)

- STEP A~D 화면을 실물 Android 기기에서 확인. 통합 정보 카드 정상, OFFLINE 문구 중복 감소,
  "오늘의 기록" 이 첫 화면 안쪽으로 올라옴.
- **날짜 경계(자정 넘김) 확인** — 9월 7일 앱 실행 시, 직전 활동은 전날 데이터이고 당일 활동/기록은
  0건인 상태에서:
  - 마지막 활동: `11시간 55분 전 · 거실` (전날 활동, 상대시간으로 유지)
  - 센서 연결: `신호가 끊겼어요`
  - 오늘 활동: `아직 확인된 활동이 없어요` (당일 0건)
  - 오늘의 기록: `아직 오늘 기록이 없어요` (당일 0건)
  네 값이 서로 모순 없이 표시됨 — 전날 `lastActivity` 유지 / 당일 활동 집계 / 당일 타임라인이
  각각 독립적으로 계산됨을 실기기에서 확인.
- 개발 실기기 UX 검증에서는 `EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2` override 사용
  (`.env`, 추적 안 됨). **실사용 안전 기준이 아니다** — 코드 기본값은 180분.

### 변경 파일

- 화면/유틸: `app/(tabs)/index.tsx`, `src/constants/strings.ts`, `src/utils/homeSummary.ts`,
  `src/utils/time.ts`, `src/components/{SectionHeader,TimelineItem,TimelineList}.tsx`
- 신규: `src/utils/deviceHealthText.ts` (`presentSensorRow`),
  `src/utils/todayActivity.ts` (`buildTodayActivitySummary` + `DAILY_LIVING_ACTIVITY_EVENT_TYPES`)
- 테스트: `scripts/phase41-devicehealth-smoke.mjs` (기기 축 + 홈 표시 14 → 30건)

---

## Phase 4.3 STEP A — 서버 재사용 가능한 상태 판정 코어

Phase 4.3 의 목표는 **보호자 앱이 실행 중이 아니어도 Cloudflare Worker(cron)가
주기적으로 상태를 계산하고 전환(NORMAL→CHECK, ONLINE→OFFLINE 등)을 감지**하는 것이다.
STEP A 에서는 그 **순수 판정 코어까지만** 만든다.

> ⛔ STEP A 에 없는 것: cron 등록 · `scheduled()` 프로덕션 로직 · Firestore 상태 문서
> write · 새 public endpoint · Worker deploy · FCM · Firebase Auth · Firestore rules 변경.
> 기존 `/ingest-device-event` · `/device-heartbeat` 는 **한 줄도 안 건드렸다** (`git diff` 로
> `server/cloudflare-worker/` 변경 0 확인, `wrangler deploy --dry-run` 번들 정상).

### 구조 선택

판정 규칙은 이미 순수 함수로 존재한다 — `deriveCareStatus` (`src/services/careStatus.ts`),
`deriveDeviceHealth` (`src/services/deviceHealth.ts`). 둘 다 firebase/react/zustand import
없이 `now` 주입 가능. **새로 설계하지 않고 이 둘을 조합**하는 얇은 코어를 추가했다:

```
src/services/careStatusSnapshot.ts   ← 공유 순수 코어 (client / Worker 공용)
  computeCareStatusSnapshot(input, now?) → { person, device, computedAt }
```

- `careStore.project()` 가 두 축을 계산하는 것과 **똑같은 인자**로 `deriveCareStatus` /
  `deriveDeviceHealth` 를 호출한다. (project() 의 오버라이드 / `presentHome` / 이벤트 스캔은
  클라이언트 UI 전용이라 코어에 넣지 않는다. 이벤트 스캔 결과 = `lastActivityAt` /
  `lastSosAt` / `hasAnyEvents` 는 어댑터가 넣는다.)
- **STEP A 에서 `careStore` 는 건드리지 않았다.** 코어는 "공유 가능한" 상태로 준비만 하고,
  클라이언트를 코어로 라우팅할지는 STEP B 에서 결정한다 (리스크 최소화).
- Cloudflare Worker(`.js`, esbuild)와 Node 스모크 러너가 모두 `.ts` 를 확장자 명시로
  import 할 수 있도록 `tsconfig.json` 에 `allowImportingTsExtensions: true` 만 추가
  (`moduleResolution: bundler` + `noEmit` 와 호환, Metro 번들 정상 확인). 무리한 monorepo
  리팩터링은 하지 않았다.

### 입력 / 출력

```ts
computeCareStatusSnapshot({
  // 어댑터가 Firestore 에서 읽어 정규화한 값
  lastActivityAt?, lastSosAt?, hasAnyEvents, emergencyAckedAt?,
  deviceDocExists, deviceLastEventAt?, lastHeartbeatAt?,
  // ⚠️ threshold 는 반드시 명시 주입 — 서버는 EXPO_PUBLIC_* / careStatusConfig 를 참조하지 않는다
  thresholds: { inactivityMinutes, deviceOfflineMinutes, emergencyLookbackHours, emergencyTtlHours },
}, now?) → {
  person: CareStatusResult,   // deriveCareStatus 결과 그대로 (status/reason/systemHealth/minutesSinceActivity/…)
  device: DeviceHealthResult, // deriveDeviceHealth 결과 그대로 (health/reason/lastSeenAt/minutesSinceSeen/…)
  computedAt: string,
}
```

- **새 상태 enum 없음.** 기존 `CareStatusResult` / `DeviceHealthResult` 를 그대로 담는다.
- 앱 개발용 `EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2` override 는 클라이언트 전용이며 서버 코어와
  무관하다. STEP A 에서 이 값 / `.env` 는 건드리지 않았다. 코드 기본값은 inactivity 180분 /
  device offline 25분 / heartbeat PoC 10분. 운영 threshold 확정은 STEP B.
- `now` 주입 필수 구조. `Date.now()` 를 함수 내부에서 직접 부르지 않는다. 저장 timestamp 는
  UTC instant, 경과는 instant 차이. "오늘 날짜" 같은 local-day 계산은 서버 판정에 넣지 않는다
  (그건 Home UX "오늘 활동" 전용). 미래 timestamp 등 비정상 입력은 `deriveCareStatus` /
  `deriveDeviceHealth` 의 기존 동작을 그대로 따른다 — 새 안전정책 없음.

### 검증

`scripts/phase43-server-carestatus-smoke.mjs` (23건, `npm run test:smoke` 포함):

- **결정적 시나리오 12** — recent+fresh, inactivity+fresh, inactivity+stale(두 축 독립),
  NORMAL+OFFLINE(사람 축 변조 없음 + Home green NORMAL 금지), EMERGENCY±OFFLINE(최우선),
  no_data, no heartbeat/no doc, threshold 직전/도달/직후, 미래 timestamp.
- **Client↔Server parity 11** — 같은 fixture 를 `careStore.project()` 의 두 derive 호출을
  그대로 미러한 경로(`appPath`) 와 `computeCareStatusSnapshot`(`serverPath`) 에 넣어
  `person` / `device` / `presentHome` 결과가 `deepEqual` 인지 확인. 코어가 검증된 domain
  함수를 **실제로 호출**하므로 "서버용 재구현" 이 아니다. (`appPath` 에 project() 가 바뀌면
  같이 고치라는 주석 표시.)
- `scripts/phase43-server-carestatus-dryrun.mjs` — Worker 가 Firestore 조회 결과를
  정규화해 코어를 호출하는 모양의 순수 dry-run (write/cron/deploy 없음).

---

## Phase 4.3 STEP B-1 — Firestore READ → normalize → compute

> ⛔ 여전히 없는 것: Firestore **status write** · cron · `scheduled()` 프로덕션 핸들러 ·
> 새 public endpoint · Worker deploy · FCM · Auth · rules 변경 · `careStore.project()` 변경.
> 이번 단계는 **완전히 READ ONLY** 다.

STEP A 의 순수 코어(`computeCareStatusSnapshot`)에 실제 데이터를 먹이는 어댑터를 만들었다.

```
Firestore
  │  readCareStatusSource()          server/cloudflare-worker/src/firestoreRead.js   (READ ONLY)
  ▼
{ events, device }
  │  normalizeCareStatusInput()      src/services/careStatusSnapshotInput.ts   (공유, 순수)
  ▼
CareStatusSnapshotInput
  │  computeCareStatusSnapshot()     src/services/careStatusSnapshot.ts   (STEP A 공유 코어)
  ▼
CareStatusSnapshot { person, device, computedAt }
```

한 곳에서 전체 흐름: `computeCareStatusFromFirestore(env, { careRecipientId, deviceId, thresholds, now })`
(`server/cloudflare-worker/src/careStatusReader.js`). STEP B-2 의 `scheduled()` 가 이 함수를
한 줄로 호출하게 된다. **이 함수는 WRITE 를 하지 않는다.**

### Firestore READ 구조

| 대상 | 방식 | 인덱스 |
| --- | --- | --- |
| `events` | `POST …/documents:runQuery` — `where careRecipientId == X` + `orderBy occurredAt DESC` + `limit 100` | **기존 인덱스 재사용** (`firestore.indexes.json`: careRecipientId ASC + occurredAt DESC). 새 인덱스 없음 |
| `devices/{deviceId}` | `GET …/documents/devices/{id}` (point read), 404 → 문서 없음 | 불필요 |

- 판정당 **read 2회** (events 쿼리 1 + devices point read 1, `Promise.all`).
- `events` 는 `eventType` 별 필터를 **하지 않는다** (그러려면 새 복합 인덱스 필요 —
  `careRecipientId + eventType + occurredAt`). 대신 최근 100건을 받아
  `normalizeCareStatusInput` 이 JS 에서 `ACTIVITY_EVENT_TYPES` 로 스캔한다.
  → **트레이드오프**: 대상자의 마지막 활동이 최근 100건보다 오래됐으면 `lastActivityAt` 을
  놓칠 수 있다(그 경우 사실상 inactivity 상태). 정밀하게 하려면 STEP B-2 에서
  전용 인덱스를 추가한다. 전체 컬렉션 스캔은 하지 않으며 항상 `careRecipientId` 로 제한.
- 아직 **인증 없이** 읽는다 (`firestore.rules` 가 events/devices read 를 `if true` 로 열어둠 —
  DEVELOPMENT ONLY). Phase 4.4 에서 규칙을 좁히면 service-account access token 필요.

### normalize 규칙 — 클라이언트와 동일

- `lastActivityAt` = `eventViews.ts` 의 **`ACTIVITY_EVENT_TYPES` 를 그대로 공유 import** 해서
  스캔한 가장 최근 activity 이벤트 시각. (motion/door/left/returned/**watch_activity**/**medication_taken**.
  Home UX 의 `DAILY_LIVING_ACTIVITY_EVENT_TYPES` 와 **다르다** — 그건 홈 "오늘 활동" 표시 전용.)
  복붙 아님. `scripts/phase43-firestore-reader-smoke.mjs` 의 parity 테스트가 고정.
- `lastSosAt` = 가장 최근 `sos_triggered` 시각 (activity 로 세지 않는다).
- `hasAnyEvents` = 조회된 이벤트가 1건 이상.
- `deviceDocExists` (문서 null 여부) 와 `lastHeartbeatAt` (필드 유무) 를 **분리**한다 —
  `deriveDeviceHealth` 의 `no_device_doc` vs `no_heartbeat_capability` 구분이 보존된다.
- **timestamp**: `toInstantIso()` 가 유효한 문자열이면 ISO instant, 아니면 `undefined`.
  **잘못된 timestamp 를 now 로 대체하지 않는다** (신호를 조작하지 않기 위해).
  경과 계산은 UTC instant 차이. local-day 계산 없음.
- **`emergencyAckedAt` = 항상 `undefined`** — 현재 데이터 모델에 서버가 읽을 수 있는 ack
  저장소가 없다 (앱 `acknowledgeEmergency()` 는 클라이언트 전용 dev 플래그). 서버 EMERGENCY 는
  TTL 로만 만료된다. 지속 ack 설계는 STEP B-2 이후.

### 검증

`scripts/phase43-firestore-reader-smoke.mjs` (**18건**, `npm run test:smoke` 포함) — Firestore REST 를
`fetch` mock 으로 흉내: activity+fresh / 오래된 activity / heartbeat stale / SOS±stale / no events /
no device doc / device doc + no heartbeat / 최근 event 가 비활동인데 이전 activity 존재 /
다중 activity·SOS 최신 선택 / `careRecipientId` 쿼리 제한 / timestamp 파싱 / threshold boundary /
ACTIVITY parity / **모든 시나리오에서 Firestore WRITE 0회 assert**.

**실제 dev Firestore READ 검증 완료** (READ ONLY, 인증/토큰 없음): `byeolileopji` 프로젝트에서
`dev-care-recipient` / `dev-device-livingroom` 를 실제 조회 → normalize → 코어 compute.
결과 (전날 활동만 있고 ESP32 는 분리된 상태): `person = CHECK / inactivity`,
`device = offline / heartbeat_stale` — 사용자가 실기기 홈에서 본 상태와 일치. WRITE 없음 확인.

### `tsconfig.json allowImportingTsExtensions`

STEP A 에서 추가했고 **유지한다.** 이제 load-bearing:
`careStatusSnapshot.ts` → `./careStatus.ts` / `./deviceHealth.ts`, `careStatusSnapshotInput.ts` →
`./careStatusSnapshot.ts` / `./eventViews.ts`, Worker `careStatusReader.js` → 두 공유 `.ts`,
스모크 2개가 모두 `.ts` 확장자 명시 import 를 쓴다. 이 설정이 있어야 **같은 파일**을
tsc(`--noEmit`) · Metro · esbuild(Worker) · Node 스모크 러너가 모두 소비한다.
제거하려면 확장자를 떼야 하는데 그러면 Node 스모크 러너가 `.ts` 를 해석하지 못한다.
검증: typecheck ✅ · `expo export` (Metro) ✅ · `esbuild --bundle careStatusReader.js` ✅
(공유 심볼 번들됨, `careStatusConfig.ts` 의 `process.env` 는 type-only import 라 erase 됨).

---

## Phase 4.3 STEP B-2 — careStatus 스냅샷 스키마 + Firestore WRITE

> ⛔ 여전히 없는 것: cron · `scheduled()` 프로덕션 핸들러 · 이전 스냅샷 비교(전환 감지, STEP B-3) ·
> FCM · Firebase Auth · rules 대규모 재설계 · Worker deploy · `careStore.project()` 변경 ·
> 운영 threshold 확정. 이번 단계는 **compute 결과를 저장 가능한 문서로 직렬화 + Firestore write** 까지다.

STEP B-1 의 `computeCareStatusFromFirestore()` 결과(`CareStatusSnapshot`)를 Firestore 에 쓴다.

```
CareStatusSnapshot { person, device, computedAt }
  │  serializeCareStatusSnapshot()   src/services/careStatusSnapshotDoc.ts   (공유, 순수)
  ▼
CareStatusSnapshotDoc   (평문 · 모든 키 emit · timestamp = Date · 없으면 null)
  │  toFirestoreFields()             server/cloudflare-worker/src/firestore.js
  ▼
PATCH …/careStatus/{careRecipientId}?updateMask=<모든 필드>   server/cloudflare-worker/src/careStatusWriter.js
```

한 줄 흐름: `computeAndWriteCareStatusSnapshot(env, { careRecipientId, deviceId, thresholds, now })`
(`careStatusWriter.js`). STEP B-4 의 `scheduled()` 가 이걸 호출한다. STEP B-3 은 write 앞에
"이전 스냅샷 read + 비교" 를 끼워넣는다.

### 저장 위치 — `careStatus/{careRecipientId}` (top-level)

| | |
| --- | --- |
| 컬렉션 | `careStatus` — `devices` / `events` 와 같은 레벨. **raw(events/devices) ↔ derived(careStatus) 를 컬렉션으로 분리** |
| 문서 id | `careRecipientId` (고정) → 대상자당 문서 **1개**. event history 처럼 새 문서를 쌓지 않는다 |
| 쓰기 | `PATCH` + `updateMask` 에 **모든 필드** → 이전 값이 무엇이든 전체 replace. 같은 스냅샷 두 번 write → 동일 문서 (**idempotent**) |
| STEP B-3 | 이전 스냅샷 = `GET careStatus/{id}` point read 1회. flat 필드라 `status`/`reason`/`deviceHealth` 비교가 `===` 몇 개 |

> README STEP B-1 의 계획 노트는 `careRecipients/{id}` 하위 서브컬렉션을 예로 들었지만("등"),
> 앱의 기존 `devices/{id}` 레지스트리 패턴과 일치시키고 `firestore.rules` 블록도 1개면 되도록
> **top-level `careStatus/{id}`** 를 골랐다.

### 스냅샷 스키마 (`CareStatusSnapshotDoc`)

```
careRecipientId, schemaVersion(=1),
// 사람 축 (deriveCareStatus 결과)
status, reason, systemHealth,
lastActivityAt|null, minutesSinceActivity|null, emergencyEventAt|null,
// 기기 축 (deriveDeviceHealth 결과)
deviceHealth, deviceHealthReason,
deviceLastEventAt|null, deviceLastHeartbeatAt|null, deviceLastSeenAt|null, deviceMinutesSinceSeen|null,
// 메타
computedAt
```

- **새 상태 enum 없음.** `CareStatusResult` / `DeviceHealthResult` 필드를 `device*` 접두사로 평탄화만 한다.
- 스키마의 **모든 키를 항상 emit** — 값 없으면 `null` (not `undefined`/`NaN`). `null` = "이번 판정엔 해당 없음"
  (예: NORMAL 스냅샷의 `emergencyEventAt`). deterministic overwrite 를 위해.
- **timestamp**: ISO 문자열 → `Date` → `firestore.js` 가 `timestampValue` 로 변환
  (`events.occurredAt` / `devices.lastHeartbeatAt` 와 동일). 잘못된/없는 시각은 `null` —
  **now 로 대체하지 않는다** (STEP B-1 신호 비조작 원칙 유지). `computedAt` 은 `snapshot` 에서 온다
  (write 시각 같은 비결정적 값을 serialize 가 만들지 않는다).
- `serialize` 는 **순수/결정적** — `careRecipientId` 누락 / `computedAt` 불량이면 throw (write 시도 전).

### threshold — STEP B-1 그대로, 이번 단계에서 재설계 안 함

- threshold 는 여전히 **호출자가 명시 주입** (`computeCareStatusFromFirestore` / `computeAndWrite…` 의
  `thresholds` 인자). 서버 코어는 `EXPO_PUBLIC_*` / `careStatusConfig` 를 참조하지 않는다.
- **운영값을 이번에 확정하지 않았다.** 앱 코드 기본값(inactivity 180분 / device offline 25분 /
  emergency 12h)이 placeholder 임은 그대로다. Worker `[vars]` 운영 threshold 는 실행 진입점
  (`scheduled()`)이 생기는 **STEP B-4 로 미룬다** — B-2 는 테스트/ dry-run 에서만 호출되고 전부 명시 주입.
- 앱 개발용 `EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2` override 는 이 경로와 무관하다 (`.env` 무변경).

### Firestore 실패 처리

- `writeCareStatusSnapshot` 은 HTTP 실패를 **삼키지 않는다** — `FirestoreError`(status 포함)를 throw 해
  호출자에게 전달한다. best-effort 아님 (`/device-heartbeat` write 와 같은 정책. `lastEventAt`
  best-effort PATCH 와 다르다). 스모크에서 403/500/503 → caller 가 throw 를 받는지 assert.
- 로그/에러 detail 에 secret(토큰·API key·device key) 없음 — Firestore 오류 본문 앞 500자만.

### `firestore.rules` 변경

새 `match /careStatus/{careRecipientId}` 블록 1개 추가:

```
allow read: if true;            // DEVELOPMENT ONLY
allow create, update: if true;  // DEVELOPMENT ONLY — 서버(Worker) 계산 결과 write
allow delete: if false;
```

- **새 컬렉션**이다 — 기존 client write 권한(`events` create / `devices` update)을 넓히지 않았다.
- Worker 가 B-1 처럼 **무인증 REST** 로 write 하므로 (default deny 상태면 write 불가) 최소 블록이 필요하다.
- Phase 4.4 에서 `read: if isLinkedGuardian(...)` / `write: if false` 로 좁힌다 (블록에 주석).
- 이 환경엔 Java / firebase-tools 가 없어 rules 를 **게시할 수 없다** → **실제 dev Firestore write 검증은
  사용자가 rules 게시 후** (B-1 은 기존 open rules 라 실제 READ 검증이 됐지만, 새 컬렉션 write 는 게시 필요).
  스모크는 `fetch` mock 으로 REST PATCH shape 를 전부 커버.
- `scripts/rules-check.mjs` 에 careStatus 블록 정적 검사 1건 추가 (6 → 7).

### 검증

`scripts/phase43-carestatus-writer-smoke.mjs` (**13건**, `npm run test:smoke` 포함) — `fetch` mock:

1. NORMAL compute → 직렬화 정확 (status/reason/systemHealth, timestamp = Date, computedAt)
2. CHECK → status/reason + minutesSinceActivity 유지
3. EMERGENCY → 최우선 + `emergencyEventAt` 보존 (기기 offline 이어도 기기 축 독립 기록)
4. timestamp 필드 → `toFirestoreFields` 가 `timestampValue`, 없는 시각 `nullValue`, round-trip
5. undefined optional → `null` (JSON 에 `undefined`/`NaN` 없음, 모든 field 존재)
6. `careRecipientId` → 문서 필드 + 경로(`careStatus/{id}`) 둘 다
7. 같은 recipient 재계산 → 동일 경로 + 동일 직렬화 (다른 대상자는 다른 문서)
8. 두 번 write → 같은 문서 `PATCH` + `updateMask` (auto-id `POST` 로 새 문서 안 쌓음)
9. write 성공 → `{ path, doc }`, throw 없음, careStatus 외 write 0
10. write 실패 403/500/503 → `FirestoreError` 가 호출자에게 throw / 10b. serialize 실패 → fetch 안 함
11. `computeAndWriteCareStatusSnapshot` — B-1 `computeCareStatusFromFirestore` 와 동일 snapshot/input
    (회귀 없음) + careStatus write 정확히 1회 + 저장 문서가 snapshot 과 일치
12. parity — 직렬화된 `status`/`reason`/`systemHealth`/`deviceHealth`/`deviceHealthReason` 가
    `deriveCareStatus` / `deriveDeviceHealth`(앱 경로) 결과와 일치

`esbuild --bundle careStatusWriter.js` ✅ · `wrangler deploy --dry-run` ✅ (`index.js` 는 아직
writer 를 import 하지 않음 — B-4 `scheduled()` 에서 연결).

### STEP B-3 / B-4 / Phase 4.4 에서 할 일

- **STEP B-3**: write 전에 `GET careStatus/{id}` (이전 스냅샷) → `status`/`reason`/`deviceHealth` 비교
  → 전환(`NORMAL→CHECK` 등) 감지. 전환 시각 필드 추가 검토.
- **STEP B-4**: `wrangler.toml` `[triggers] crons` + `scheduled()` → `computeAndWriteCareStatusSnapshot`.
  **운영 threshold 확정** (Worker `[vars]`, 앱 개발 override 와 분리 유지). Worker deploy + rules 게시.
- (선택) `events` `eventType` 필터용 복합 인덱스 추가 여부 결정.
- **지속 ack 저장소** 설계 (서버 EMERGENCY 를 보호자가 확인 처리 — 현재 서버 EMERGENCY 는 TTL 로만 만료).
- **Phase 4.4**: 전환 → FCM 푸시. Firebase Auth + `firestore.rules` 좁히기 (careStatus write = 서버만).

---

## 이번 Phase(3) 에서 구현하지 않은 것

로그인 UI / OAuth · Firebase Auth · PIR 장기 안정성 / 낙상 감지 / 추가 센서 ·
service account 기반 서버 인증 · per-device key · Cloud Functions · MQTT ·
Galaxy Watch · Wear OS 앱 · GPS · 푸시 알림 · 실제 복약 알림 · AI / ML ·
119 자동 신고 · 관리자 페이지 · 결제 · 여러 보호대상 전환 UI
