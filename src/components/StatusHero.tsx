import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';
import type { StatusTone } from '../utils/careStatusText';

interface StatusHeroProps {
  /** 색 톤. 'neutral' 은 확정 상태가 아닐 때(no_data / 기기 offline 등). */
  tone: StatusTone;
  emoji: string;
  headline: string;
  /** 예: "12분 전에 활동이 확인됐어요." */
  subtext?: string;
}

const TONE_PALETTE: Record<StatusTone, { fg: string; bg: string }> = {
  normal: colors.status.NORMAL,
  check: colors.status.CHECK,
  emergency: colors.status.EMERGENCY,
  // 확정 상태가 아닐 때는 초록/노랑/빨강 대신 중립 톤을 쓴다.
  neutral: { fg: colors.textSecondary, bg: colors.surfaceMuted },
};

/**
 * 홈 최상단의 큰 상태 표시.
 * 색만으로 구분하지 않도록 이모지 + 문구를 항상 함께 노출한다.
 */
export function StatusHero({ tone, emoji, headline, subtext }: StatusHeroProps) {
  const palette = TONE_PALETTE[tone];

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <Text style={styles.emoji} accessibilityElementsHidden>
        {emoji}
      </Text>
      <Text style={[styles.headline, { color: palette.fg }]}>{headline}</Text>
      {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  headline: {
    ...typography.hero,
    textAlign: 'center',
  },
  subtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
