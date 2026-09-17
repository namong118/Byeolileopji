import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, shadows, typography } from '../constants/theme';

type IoniconName = keyof typeof Ionicons.glyphMap;
type BadgeTone = 'mint' | 'blue';

interface SummaryCardProps {
  icon: IoniconName;
  label: string;
  value: string;
  secondary?: string;
  /** 아이콘 원형 배지 색 — mint(Green 계열, "생활" 포인트) 또는 blue(그 외 대부분). */
  tone?: BadgeTone;
  /** 기기 연결처럼 "사람의 안부"와 분리해 값 텍스트만 한 단계 낮춰 보여줄 때 */
  muted?: boolean;
}

const BADGE_STYLE: Record<BadgeTone, { bg: string; icon: string }> = {
  mint: { bg: colors.mint, icon: colors.green },
  blue: { bg: colors.lightBlue, icon: colors.blue },
};

/**
 * "한눈에 보기" 2×2 그리드의 카드 1개.
 * 4칸이 무지개처럼 보이지 않게 Green/Blue 두 톤 안에서만 배지 색을 쓴다.
 * border 없이 매우 옅은 shadow로만 표면을 구분한다(흰 사각형+테두리 반복 지양).
 */
export function SummaryCard({
  icon,
  label,
  value,
  secondary,
  tone = 'blue',
  muted,
}: SummaryCardProps) {
  const badge = BADGE_STYLE[tone];

  return (
    <View style={styles.card}>
      <View style={[styles.iconBadge, { backgroundColor: badge.bg }]}>
        <Ionicons name={icon} size={16} color={badge.icon} />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[styles.value, muted && styles.valueMuted]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    ...shadows.soft,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  value: {
    ...typography.cardValue,
    color: colors.textPrimary,
    marginTop: 1,
  },
  valueMuted: {
    color: colors.textSecondary,
  },
  secondary: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
});
