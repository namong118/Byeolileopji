/**
 * 별일없지 디자인 토큰.
 *
 * 브랜드 컬러가 아직 확정되지 않았으므로 색상은 이 파일에서만 정의한다.
 * 색을 바꾸려면 `palette` 값만 교체하면 앱 전체에 반영된다.
 */

const palette = {
  // 따뜻하고 밝은 기본 톤
  cream: '#FFFDF9',
  sand: '#F5EFE6',
  ink: '#2C2A26',
  inkSoft: '#6B6760',
  line: '#EAE3D8',
  white: '#FFFFFF',

  // 상태 색 (색만으로 구분하지 않고 항상 텍스트를 함께 노출한다)
  normal: '#3FA96A',
  normalSoft: '#E7F5EC',
  check: '#E0A63C',
  checkSoft: '#FBF1DE',
  emergency: '#D9534F',
  emergencySoft: '#FBE9E8',

  // 포인트 (안심을 주는 부드러운 청록)
  accent: '#4C9A8F',
  accentSoft: '#E6F1EF',
};

export const colors = {
  background: palette.cream,
  surface: palette.white,
  surfaceMuted: palette.sand,
  border: palette.line,

  textPrimary: palette.ink,
  textSecondary: palette.inkSoft,

  accent: palette.accent,
  accentSoft: palette.accentSoft,

  status: {
    NORMAL: { fg: palette.normal, bg: palette.normalSoft },
    CHECK: { fg: palette.check, bg: palette.checkSoft },
    EMERGENCY: { fg: palette.emergency, bg: palette.emergencySoft },
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
} as const;

export const typography = {
  hero: { fontSize: 26, fontWeight: '700' as const, lineHeight: 34 },
  title: { fontSize: 20, fontWeight: '700' as const, lineHeight: 28 },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, lineHeight: 20 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
} as const;

export const theme = { colors, spacing, radius, typography };
export type Theme = typeof theme;
