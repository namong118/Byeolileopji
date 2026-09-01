import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';
import { CARE_STATUS_VIEW, type CareStatus } from '../types/status';

interface StatusHeroProps {
  status: CareStatus;
  /** 예: "12분 전에 활동이 확인됐어요." */
  subtext?: string;
}

/**
 * 홈 최상단의 큰 상태 표시.
 * 색만으로 구분하지 않도록 이모지 + 문구를 항상 함께 노출한다.
 */
export function StatusHero({ status, subtext }: StatusHeroProps) {
  const view = CARE_STATUS_VIEW[status];
  const palette = colors.status[status];

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <Text style={styles.emoji} accessibilityElementsHidden>
        {view.emoji}
      </Text>
      <Text style={[styles.headline, { color: palette.fg }]}>
        {view.headline}
      </Text>
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
