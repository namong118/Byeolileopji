import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontFamily, radius, shadows, spacing, typography } from '../constants/theme';
import type { StatusTone } from '../utils/careStatusText';

interface StatusHeroProps {
  /** 색 톤. 'neutral' 은 확정 상태가 아닐 때(no_data / 기기 offline 등). */
  tone: StatusTone;
  headline: string;
  /** 예: "12분 전에 활동이 확인됐어요." */
  subtext?: string;
  /** "최근 활동" 처럼 카드 안에 보조로 덧붙일 한 줄. 값이 없으면 행 자체를 그리지 않는다. */
  lastActivityLabel?: string;
  lastActivityValue?: string;
}

type IoniconName = keyof typeof Ionicons.glyphMap;

interface ToneStyle {
  icon: IoniconName;
  cardBg: string;
  iconColor: string;
}

// 상태별 시각 차이는 "배경 tint + 아이콘 색"만으로 만든다. headline/subtext는
// 모든 톤에서 항상 Deep Navy/Secondary — 카드 전체가 색으로 뒤덮여 "경고 박스"
// 처럼 보이지 않게 하기 위한 의도적 결정이다 (Blue/Green/Amber/Coral 은 아이콘에만).
const TONE_STYLE: Record<StatusTone, ToneStyle> = {
  normal: {
    icon: 'checkmark-circle',
    cardBg: colors.status.NORMAL.bg,
    iconColor: colors.status.NORMAL.fg,
  },
  check: {
    icon: 'information-circle',
    cardBg: colors.status.CHECK.bg,
    iconColor: colors.status.CHECK.fg,
  },
  emergency: {
    icon: 'alert-circle',
    cardBg: colors.status.EMERGENCY.bg,
    iconColor: colors.status.EMERGENCY.fg,
  },
  neutral: {
    // 기기 연결 확인 중 — Blue(연결/신뢰 역할)를 쓰지만 배경은 아주 옅게,
    // headline 은 Deep Navy 그대로라 "기기 이상"처럼 튀어 보이지 않는다.
    icon: 'time-outline',
    cardBg: colors.surfaceMuted,
    iconColor: colors.accent,
  },
};

/**
 * 홈 최상단 "오늘의 안부" 카드.
 * 사람의 안부가 주 정보다 — 기기 연결 상태(neutral 톤)가 와도 카드가 경고처럼
 * 보이지 않도록 항상 같은 차분한 레이아웃(옅은 배경+작은 아이콘+텍스트)만 쓴다.
 * 로고/일러스트/배경 패턴을 넣지 않는다.
 */
export function StatusHero({
  tone,
  headline,
  subtext,
  lastActivityLabel,
  lastActivityValue,
}: StatusHeroProps) {
  const style = TONE_STYLE[tone];
  const showLastActivity = Boolean(lastActivityLabel && lastActivityValue);

  return (
    <View style={[styles.container, { backgroundColor: style.cardBg }]}>
      <Text style={styles.eyebrow}>오늘의 안부</Text>

      <View style={styles.mainRow}>
        <View style={styles.iconBadge}>
          <Ionicons name={style.icon} size={18} color={style.iconColor} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.headline}>{headline}</Text>
          {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
        </View>
      </View>

      {showLastActivity ? (
        <View style={styles.lastActivityRow}>
          <Text style={styles.lastActivityLabel}>{lastActivityLabel}</Text>
          <Text style={styles.lastActivityValue}>{lastActivityValue}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  eyebrow: {
    ...typography.caption,
    fontFamily: fontFamily.semiBold,
    color: colors.textSecondary,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  textCol: {
    flex: 1,
  },
  headline: {
    ...typography.statusHeadline,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  subtext: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 2,
  },
  lastActivityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastActivityLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  lastActivityValue: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
