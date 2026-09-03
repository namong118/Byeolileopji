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
Phase 1  ✅  Guardian App + Mock Event Pipeline
Phase 2  ✅  Supabase Backend + Event Persistence   ← 현재
Phase 3  ⏳  ESP32-S3 + PIR 센서 실연동
Phase 4  ⏳  NORMAL / CHECK 자동 판단 (무활동 시간 기반) + 보호자 인증/RLS
Phase 5  ⏳  복약 관리 + 스마트워치 Mock 통합
```

> Phase 2 는 코드/스키마/마이그레이션까지 완료됐다.
> 실제 Supabase 프로젝트에 연결하려면 아래 **Backend / Database setup** 을 따른다.
> Supabase 환경변수가 없으면 앱은 자동으로 In-Memory 목업 모드로 동작한다.

---

## 최종 PoC 목표 (2026-09-27)

```text
PIR Sensor → ESP32-S3 → Wi-Fi → Supabase → Event Pipeline → 별일없지 App
                                                              ↓
                                    최근 활동 표시 / 일정 시간 무활동 시 CHECK 상태
```

---

## 기술 스택

- Expo (SDK 57) / React Native 0.86 / React 19
- TypeScript (strict)
- expo-router (파일 기반 네비게이션)
- zustand (UI 상태)
- **@supabase/supabase-js (Backend / 영속 저장)**

---

## Backend

**Supabase (PostgreSQL)**

이벤트는 `events` 테이블에 `timestamptz`(UTC)로 저장된다.
앱은 저장소 추상화(`EventRepository`)의 구현체만 바꿔 연결한다 —
UI·store·service 코드는 Phase 1 과 동일하다.

```text
Developer Simulation
        ↓
CareEvent 생성
        ↓
careStore  →  EventService  →  EventRepository
                               ├─ SupabaseEventRepository   (env 설정 시)
                               └─ InMemoryEventRepository    (폴백, 목업)
        ↓
Supabase PostgreSQL  (events)
        ↓
다시 조회 → careStore → Home / Timeline
```

앱을 완전히 종료했다가 다시 열어도 이전 이벤트가 남아 있다.

---

## 환경변수

`.env.example` 를 복사해 `.env` 를 만든다. (`.env` 는 git 에 커밋되지 않는다)

```bash
cp .env.example .env
```

| 변수 | 설명 |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon (public) key — RLS 전제 하에 사용 |
| `EXPO_PUBLIC_CARE_RECIPIENT_ID` | (선택) 개발용 보호대상 UUID 오버라이드 |
| `EXPO_PUBLIC_DEVICE_ID` | (선택) 개발용 디바이스 UUID 오버라이드 |

값은 **Supabase 대시보드 > Project Settings > API** 에서 확인한다.

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` 는 클라이언트 앱(.env 포함)에 **절대** 넣지 않는다.
> RLS 를 우회할 수 있는 키다.

환경변수를 바꾼 뒤에는 Expo 개발 서버를 재시작한다 (`npm start -c`).

---

## Database setup

DB 스키마는 `supabase/migrations/` 에 SQL 로 관리된다.

```text
supabase/migrations/
  20260903000100_initial_schema.sql        테이블 · 인덱스 · 트리거 · RLS · 운영 정책
  20260903000200_seed_dev_data.sql         개발용 seed (김영희 / 거실 모션센서)
  20260903000300_dev_only_anon_policies.sql ⚠️ DEVELOPMENT ONLY — anon 임시 권한
```

### 방법 A — Supabase SQL Editor (가장 빠름, CLI 불필요)

1. [supabase.com](https://supabase.com) 에서 새 프로젝트 생성
2. 대시보드 > **SQL Editor** 에서 위 3개 파일 내용을 **순서대로** 붙여넣고 실행
3. **Project Settings > API** 에서 URL / anon key 복사 → `.env` 에 입력

### 방법 B — Supabase CLI

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push        # supabase/migrations/*.sql 적용
```

### RLS / 보안 현황

- 모든 사용자 데이터 테이블에 **RLS 활성화**.
- `20260903000100` 의 정책은 **보호자 인증(`auth.uid()`) 이후** 를 전제로 한다
  → `guardian_relationships` 에 (보호자 user ↔ 보호대상) 행이 있어야 조회 가능.
- Phase 2 에는 로그인 UI 가 없으므로, PoC 를 돌리려면 `20260903000300`
  (**DEVELOPMENT ONLY**, anon 읽기/쓰기 허용) 을 함께 적용한다.
- Phase 4 에서 Supabase Auth 도입 시 `20260903000300` 을 되돌리는
  마이그레이션(`..._drop_dev_anon_policies.sql`)을 추가하고, 실제 보호자 관계를 넣는다.
- 현재 상태는 **Production-ready 가 아니다.** (anon key 로 이벤트 읽기/쓰기 가능)

---

## Database Schema

| 테이블 | 역할 | 핵심 컬럼 |
| --- | --- | --- |
| `care_recipients` | 보호대상(어르신) | `id`, `name`, `created_at`, `updated_at` |
| `devices` | 센서 / 스마트워치 (동일 모델) | `id`, `care_recipient_id→care_recipients`, `device_type`(check), `name`, `location`, `is_active` |
| `guardian_relationships` | 보호자(auth user) ↔ 보호대상 | `guardian_user_id→auth.users`, `care_recipient_id→care_recipients`, `relationship` |
| `events` | 생활 이벤트 (핵심) | `id`, `care_recipient_id→care_recipients`, `device_id→devices`, `event_type`(check), `source`(check), `location`, `payload` jsonb, `occurred_at` timestamptz, `created_at` |

- `event_type` / `source` 는 CHECK constraint 로 값을 강제한다
  (초기 단계에서 PostgreSQL enum 보다 마이그레이션이 가볍다).
- 주 조회 인덱스: `events (care_recipient_id, occurred_at desc)`.
- `updated_at` 은 트리거로 자동 갱신.

DB row(snake_case) ↔ 도메인 `CareEvent`(camelCase) 변환은
`src/services/supabase/eventMapper.ts` 에서만 일어난다.

---

## 프로젝트 구조

```text
app/                         expo-router 라우트
  _layout.tsx                루트 (Provider + 스토어 init)
  (tabs)/_layout.tsx         하단 탭 (홈 / 오늘의 기록 / 개발자)
  (tabs)/index.tsx           홈
  (tabs)/timeline.tsx        오늘의 기록 (loading / empty / error 처리)
  (tabs)/developer.tsx       개발자 시뮬레이션 (Data Source 표시, 저장 오류 표시)

src/
  components/                재사용 UI (Card, StatusHero, TimelineList, Notice ...)
  config/
    env.ts                   EXPO_PUBLIC_* 환경변수 · isSupabaseConfigured()
    careContext.ts           개발용 보호대상/디바이스 고정 UUID
  constants/                 theme(색·간격·타이포), strings(브랜드 문구)
  types/                     CareEvent / CareStatus 모델
  services/
    eventRepository.ts       EventRepository 인터페이스 + InMemory 구현
    eventService.ts          도메인 로직 + 저장소 선택(팩토리)
    supabase/
      client.ts              Supabase 클라이언트 싱글턴 (anon only)
      database.types.ts      테이블 최소 타입
      eventMapper.ts         row ↔ CareEvent 변환 (런타임 import 없음)
      supabaseEventRepository.ts  Supabase 기반 EventRepository 구현
  stores/careStore.ts        UI 반응형 상태 (loading / error / dataSource)
  mock/                      보호대상 · seed 이벤트 · 시뮬레이션 버튼 정의
  utils/                     시간 포맷, 이벤트 → 한국어 문구, 홈 요약 계산

supabase/
  config.toml                CLI 최소 설정
  migrations/                스키마 · seed · dev 정책 SQL

scripts/phase2-smoke.mjs     순수 매핑/필터 스모크 테스트
```

UI 에는 기술 용어(PIR, `motion_detected`, Supabase 등)를 노출하지 않고
`src/utils/eventPresenter.ts` 를 통해 "거실에서 활동이 확인됐어요." 같은
문장으로 변환한다.

---

## 실행 방법

```bash
npm install
cp .env.example .env     # Supabase 값 입력 (없으면 In-Memory 목업 모드)
npm start                # Expo 개발 서버 · i(iOS) / a(Android) / Expo Go QR
```

기타 스크립트:

```bash
npm run android     # Android 로 바로 실행
npm run ios          # iOS 로 바로 실행
npm run typecheck    # tsc --noEmit
npm run lint         # eslint (expo config)
npm run test:smoke   # 순수 매핑/필터 스모크 테스트
```

**Data Source 확인:** 개발자 탭 상단에 `Supabase (영속 저장)` /
`In-Memory (앱 종료 시 초기화)` 배지가 표시된다.

---

## 검증

### Phase 2

- `npm run typecheck` — 통과 (strict)
- `npm run lint` — 통과
- `npx expo-doctor` — 21/21 통과
- `npx expo export --platform android` — 번들 생성 성공 (supabase-js 포함)
- `npm run test:smoke` — 10/10 통과
  (row→CareEvent 매핑 · CareEvent→insert payload · round-trip · 오늘 필터 ·
   eventPresenter · InMemory 폴백)
- Supabase 실연결(INSERT → SELECT → 앱 재시작 → 유지): **미검증**
  (이 저장소에는 실제 Supabase credential 이 없음. 위 setup 후 검증 필요)

### 테스트 방식에 대해

`jest-expo` 는 현재 프로젝트 규모(화면 3개, 순수 함수 위주) 대비 설정 비용이 커서
도입하지 않았다. 대신 Node 내장 TypeScript 실행으로 순수 매핑·필터 함수를 검증한다
(`scripts/phase2-smoke.mjs`). 화면 로직은 typecheck + Metro 번들로 커버한다.
Phase 4(자동 판단 로직)에서 판단 규칙이 복잡해지면 jest 도입을 재검토한다.

---

## 이번 Phase 에서 구현하지 않은 것

로그인 UI / OAuth · ESP32 · PIR 센서 · MQTT · Galaxy Watch · Wear OS 앱 ·
GPS · 푸시 알림 · 실제 복약 알림 · AI / ML · 무활동 자동 판단 · 119 자동 신고 ·
관리자 페이지 · 결제 · 여러 보호대상 전환 UI · Realtime 구독

---

## Roadmap 상세

| Phase | 내용 |
| --- | --- |
| **Phase 1** | Guardian App + Mock Event Pipeline |
| **Phase 2** | Supabase Backend + Event Persistence |
| Phase 3 | ESP32-S3 + PIR 센서 → Wi-Fi → Supabase (엣지 함수 또는 서비스 역할로 INSERT) |
| Phase 4 | NORMAL / CHECK 자동 판단 (무활동 시간) + Supabase Auth + RLS 실적용 |
| Phase 5 | 복약 관리 + 스마트워치 Mock 통합 |
