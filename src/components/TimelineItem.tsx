import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontFamily, radius, spacing, typography } from '../constants/theme';
import type { CareEvent } from '../types/events';
import { presentEvent, presentEventCategory } from '../utils/eventPresenter';
import { formatClock } from '../utils/time';

interface TimelineItemProps {
  event: CareEvent;
  /** 오늘의 첫 이벤트면 특별 문구를 쓸 수 있도록 */
  overrideMessage?: string;
  last?: boolean;
  /** 홈 미리보기: 행 간격을 줄여 더 많이 보이게 한다. 전체 탭에서는 false. */
  compact?: boolean;
}

type IoniconName = keyof typeof Ionicons.glyphMap;

const CATEGORY_BADGE: Record<
  ReturnType<typeof presentEventCategory>,
  { icon: IoniconName; bg: string; color: string }
> = {
  // 생활 움직임 신호 — "한눈에 보기"의 최근 활동과 같은 Green 계열로 통일.
  activity: { icon: 'walk-outline', bg: colors.mint, color: colors.green },
  // 그 외 정기 신호 — 집 안에서의 신호이므로 "집 안 기기"와 같은 Blue 계열.
  routine: { icon: 'home-outline', bg: colors.lightBlue, color: colors.blue },
  // 확인이 필요한 신호(SOS, 복약 누락) — 상태색 CHECK(Amber)와 통일.
  attention: {
    icon: 'alert-circle',
    bg: colors.status.CHECK.bg,
    color: colors.status.CHECK.fg,
  },
};

/**
 * Timeline 한 줄 — "시간 | 컬러 아이콘 배지 | 자연어 문장" 구조.
 * rail(세로 연결선) 없음 — 센서 로그가 아니라 하루의 기록처럼 깔끔한 리스트로 보인다.
 */
export function TimelineItem({
  event,
  overrideMessage,
  last,
  compact,
}: TimelineItemProps) {
  const message = overrideMessage ?? presentEvent(event).message;
  const badge = CATEGORY_BADGE[presentEventCategory(event.eventType)];

  return (
    <View
      style={[
        styles.row,
        !last && (compact ? styles.rowGapCompact : styles.rowGap),
      ]}
    >
      <Text style={styles.time}>{formatClock(event.occurredAt)}</Text>
      <View style={[styles.iconBadge, { backgroundColor: badge.bg }]}>
        <Ionicons name={badge.icon} size={15} color={badge.color} />
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowGap: {
    marginBottom: spacing.lg,
  },
  rowGapCompact: {
    marginBottom: spacing.md,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    width: 64,
  },
  iconBadge: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    ...typography.body,
    fontFamily: fontFamily.medium,
    color: colors.textPrimary,
    flex: 1,
  },
});
