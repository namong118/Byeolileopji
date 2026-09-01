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

## 현재 Phase

### Phase 1 — Guardian App + Mock Event Pipeline

실제 하드웨어나 Backend 없이, Mock 데이터로 보호자 앱의 핵심 UX와
데이터 흐름을 먼저 구축한다.

동작하는 화면:

| 화면 | 설명 |
| --- | --- |
| **홈** | 현재 안심 상태(정상 / 확인 필요 / 긴급), 마지막 활동, 오늘의 상태 요약, 최근 기록 |
| **오늘의 기록** | 오늘 발생한 생활 이벤트를 시간 역순으로 표시 |
| **개발자** | Mock 이벤트 발생 버튼 8종 + 상태 강제 변경 (Production 에서 숨김) |

개발자 화면에서 이벤트를 발생시키면 홈과 타임라인에 즉시 반영된다.

---

## 최종 PoC 목표 (2026-09-27)

```text
PIR Sensor
    ↓
ESP32-S3
    ↓
Wi-Fi
    ↓
Supabase
    ↓
Event Pipeline
    ↓
별일없지 App
    ↓
최근 활동 표시 / 일정 시간 무활동 시 CHECK 상태
```

---

## Roadmap

| Phase | 내용 |
| --- | --- |
| **Phase 1** | Guardian App + Mock Event Pipeline |
| Phase 2 | Supabase 연동 (저장소 구현체 교체) |
| Phase 3 | ESP32-S3 + PIR 센서 실연동 |
| Phase 4 | NORMAL / CHECK 자동 판단 (무활동 시간 기반) |
| Phase 5 | 복약 관리 + 스마트워치 Mock 통합 |

---

## 기술 스택

- Expo (SDK 57) / React Native 0.86 / React 19
- TypeScript (strict)
- expo-router (파일 기반 네비게이션)
- zustand (UI 상태)

---

## 프로젝트 구조

```text
app/                        expo-router 라우트
  _layout.tsx               루트 레이아웃 (Provider + 스토어 init)
  (tabs)/
    _layout.tsx             하단 탭 (홈 / 오늘의 기록 / 개발자)
    index.tsx               홈
    timeline.tsx            오늘의 기록
    developer.tsx           개발자 시뮬레이션

src/
  components/               재사용 UI (Card, StatusHero, TimelineList ...)
  constants/                theme(색·간격·타이포), strings(브랜드 문구)
  types/                    CareEvent / CareStatus 모델
  services/
    eventRepository.ts      저장소 인터페이스 + InMemory 구현 (Phase 2 교체 지점)
    eventService.ts         이벤트 도메인 로직
  stores/
    careStore.ts            UI 가 구독하는 반응형 상태 (zustand)
  mock/                     보호대상·시드 이벤트·시뮬레이션 버튼 정의
  utils/                    시간 포맷, 이벤트 → 한국어 문구 변환, 홈 요약 계산

assets/                     아이콘 / 스플래시
```

### 데이터 흐름

```text
UI (화면)
  ↓  simulateEvent()
careStore (zustand)
  ↓
EventService
  ↓
EventRepository   ← 현재: InMemoryEventRepository
                    Phase 2: SupabaseEventRepository 로 교체
```

향후 Supabase / ESP32 / Wear OS 데이터는 모두 공통 `CareEvent` 형태로
정규화되어 같은 파이프라인을 사용한다.

UI 에는 기술 용어(PIR, `motion_detected` 등)를 노출하지 않고
`src/utils/eventPresenter.ts` 를 통해 "거실에서 활동이 확인됐어요." 같은
문장으로 변환한다.

---

## 실행 방법

```bash
npm install
npm start          # Expo 개발 서버
# 그 다음
#   i  → iOS 시뮬레이터
#   a  → Android 에뮬레이터
#   Expo Go 앱으로 QR 스캔
```

기타 스크립트:

```bash
npm run android    # Android 로 바로 실행
npm run ios         # iOS 로 바로 실행
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (expo config)
```

---

## 검증 (Phase 1)

- `npm run typecheck` — 통과 (strict)
- `npm run lint` — 통과
- `npx expo-doctor` — 21/21 통과
- `npx expo export --platform android` — 번들 생성 성공
- Mock 이벤트 파이프라인 스모크 테스트 — 시드 주입 / 이벤트 발생 / 홈 요약 / 상태 변경 정상

---

## 이번 Phase 에서 구현하지 않은 것

Supabase · 인증 · ESP32 · PIR 센서 · MQTT · Galaxy Watch · GPS ·
푸시 알림 · 실제 복약 알림 · AI / ML · 이상 행동 분석 · 119 자동 신고 ·
결제 · 관리자 페이지
