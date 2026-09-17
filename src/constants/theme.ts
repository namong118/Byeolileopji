/**
 * 별일없지 디자인 토큰 — Phase UI-8 Visual Redesign (레퍼런스 기반 프리미엄 패스).
 *
 * 새 앱 아이콘(별 외곽선 + 생활신호선, Green→Teal→Blue gradient)과 어울리는
 * flat color 중심의 UI 팔레트. Gradient는 이 토큰 레이어에서 정의하지 않는다 —
 * 핵심 CTA/작은 브랜드 포인트에서만 컴포넌트가 직접, 매우 제한적으로 사용한다.
 *
 * 색상 역할(임의로 섞지 않는다):
 *  - Green  = 정상 / 생활 / 안심 (careStatus NORMAL)
 *  - Teal   = 브랜드 / 연결 (brand accent)
 *  - Blue   = Navigation / CTA / interaction (colors.accent)
 *
 * 배경은 Warm Cream(노란/베이지 톤)을 쓰지 않는다 — 매우 옅은 Cool Blue/Neutral.
 * "노란색 감성 앱"처럼 보이지 않게 하기 위한 명시적 결정이다.
 *
 * 상태색은 색상만으로 의미를 전달하지 않는다(항상 아이콘+텍스트 동반, 각 컴포넌트가 책임).
 *
 * ⚠️ `star` / `deepNavy` / `status.X.accent` 는 레거시 키(예전 이름)라 이름만
 * 남기고 새 팔레트 값으로 교체했다.
 */

const palette = {
  // ── 브랜드 (제한적으로만 사용 — 남발 금지) ──────────────────────────
  primaryGreen: '#22C55E',
  teal: '#14B8A6',
  blue: '#3B82F6',

  // ── 배경 (Cool White/Blue — Warm Cream 아님) ────────────────────────
  appBackground: '#F8FBFF',
  lightMint: '#E6F7F4',
  lightBlue: '#EFF6FF',
  white: '#FFFFFF',

  // ── 텍스트 ───────────────────────────────────────────────────────
  mainText: '#17324D',
  secondaryText: '#7A8998',

  // ── Neutral ──────────────────────────────────────────────────────
  border: '#E8ECEF',

  // ── 상태 (자극적이지 않은 배경 + 충분히 진한 전경) — CHECK 의 Warm Yellow
  //    는 상태 표시 전용으로만 제한적으로 쓴다(배경 전체에는 쓰지 않음) ───
  normalBg: '#E6F7F4',
  normalFg: '#168A67',
  checkBg: '#FFF4D8',
  checkFg: '#B7791F',
  emergencyBg: '#FDE8E7',
  emergencyFg: '#C84C4C',
} as const;

export const colors = {
  background: palette.appBackground,
  surface: palette.white,
  surfaceMuted: palette.lightBlue,
  border: palette.border,

  textPrimary: palette.mainText,
  textSecondary: palette.secondaryText,

  // Blue = Navigation / CTA / interaction (내비게이션 active, 링크, solid 버튼)
  accent: palette.blue,
  accentSoft: `${palette.blue}1A`,

  // Teal = 브랜드 / 연결 — 작은 브랜드 포인트에서만 제한적으로 사용
  brandAccent: palette.teal,

  // 원색 그대로도 노출(제한적 사용처용: 아이콘 배지, 작은 브랜드 포인트 등)
  green: palette.primaryGreen,
  teal: palette.teal,
  blue: palette.blue,
  mint: palette.lightMint,
  lightBlue: palette.lightBlue,

  // ⚠️ 레거시 키 — 이름만 남기고 값은 새 팔레트.
  star: palette.teal,
  deepNavy: palette.blue,

  status: {
    NORMAL: { bg: palette.normalBg, fg: palette.normalFg, accent: palette.normalFg },
    CHECK: { bg: palette.checkBg, fg: palette.checkFg, accent: palette.checkFg },
    EMERGENCY: { bg: palette.emergencyBg, fg: palette.emergencyFg, accent: palette.emergencyFg },
  },
} as const;

/** 8pt 기반. `screen` 은 화면 좌우 패딩 전용(20). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  screen: 20,
  xl: 24,
  xxl: 32,
} as const;

/** Card 는 20으로 통일. sm 은 작은 컴포넌트(입력창/배지/버튼) 전용. */
export const radius = {
  sm: 12,
  md: 20,
  lg: 20,
  /** 아이콘 원형 배지 전용 (완전한 원을 만들 때 각 컴포넌트가 size/2 로 계산) */
  pill: 999,
} as const;

/**
 * Pretendard 4-weight family map. `app/_layout.tsx` 의 `useFonts` 로 로드한
 * asset 파일명(확장자 제외)과 정확히 같은 문자열이어야 한다.
 *
 * ⚠️ weight 는 항상 이 family 선택만으로 표현한다 — 아래 `typography` 토큰과
 * 각 컴포넌트의 로컬 오버라이드 모두 `fontWeight` 를 별도로 주지 않는다.
 * 커스텀 폰트에 `fontWeight` 를 함께 주면(특히 Android) 존재하지 않는 두께의
 * 변형을 찾다가 시스템 폰트로 조용히 fallback 되거나 가짜(합성) 볼드가 적용될
 * 수 있기 때문이다.
 */
export const fontFamily = {
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semiBold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
} as const;

export const typography = {
  /** Page title (26~27 / Bold) — 타이트한 line-height로 정제된 인상 */
  hero: { fontFamily: fontFamily.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  /** Status headline (21~22 / SemiBold) — StatusHero 전용. Page title 과 무게가
   *  경쟁하지 않도록 Bold 가 아니라 SemiBold 을 쓴다. */
  statusHeadline: { fontFamily: fontFamily.semiBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.1 },
  title: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 27, letterSpacing: -0.2 },
  /** Section title (18~19 / SemiBold) — Page title/Status headline 과 경쟁하지 않도록
   *  한 단계 가볍게. 살짝 벌어진 letter-spacing으로 "라벨" 느낌은 유지. */
  sectionTitle: { fontFamily: fontFamily.semiBold, fontSize: 18, lineHeight: 24, letterSpacing: 0.1 },
  /** Summary primary value (18~19 / SemiBold) */
  cardValue: { fontFamily: fontFamily.semiBold, fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
  /** Body / Description (14~16 / Regular) */
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamily.semiBold, fontSize: 16, lineHeight: 24 },
  /** Label / Caption / Secondary (12~14 / Medium) — 라벨용으로 쓸 때 살짝 letter-spacing */
  caption: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
} as const;

/**
 * 매우 약한 elevation 전용 — 남용하지 않는다. `Card` 의 `variant="elevated"` 및
 * StatusHero 등 "떠 있는" 느낌이 필요한 한정된 곳에만 쓴다. "카드가 떠 있다"가
 * 아니라 "배경 위에 살짝 구분된다" 정도로만(opacity 0.04, elevation 최소값).
 */
export const shadows = {
  soft: {
    shadowColor: palette.mainText,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
} as const;

export const theme = { colors, spacing, radius, typography, shadows, fontFamily };
export type Theme = typeof theme;
