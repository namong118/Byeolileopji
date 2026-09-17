import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography } from '../constants/theme';
import type { CareEvent } from '../types/events';
import { presentFirstActivityOfDay } from '../utils/eventPresenter';
import { TimelineItem } from './TimelineItem';

interface TimelineListProps {
  events: CareEvent[];
  /** 최대 표시 개수 (홈의 미리보기에서 사용) */
  limit?: number;
  /** 목록 중 가장 이른 항목을 "오늘 첫 활동" 문구로 표시 */
  markFirstActivity?: boolean;
  /** 홈 미리보기: 행 간격을 줄인다. 전체 탭에서는 지정하지 않는다. */
  compact?: boolean;
}

export function TimelineList({
  events,
  limit,
  markFirstActivity,
  compact,
}: TimelineListProps) {
  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconBadge}>
          <Ionicons name="document-text-outline" size={18} color={colors.blue} />
        </View>
        <View style={styles.emptyTextCol}>
          <Text style={styles.emptyTitle}>아직 오늘 기록이 없어요.</Text>
          <Text style={styles.emptySubtitle}>활동이 확인되면 이곳에 표시됩니다.</Text>
        </View>
      </View>
    );
  }

  const shown = limit ? events.slice(0, limit) : events;
  const showingAll = shown.length === events.length;

  return (
    <View>
      {shown.map((event, index) => {
        const isLast = index === shown.length - 1;
        const isEarliestOfDay = showingAll && isLast;
        const override =
          markFirstActivity &&
          isEarliestOfDay &&
          event.eventType === 'motion_detected'
            ? presentFirstActivityOfDay()
            : undefined;

        return (
          <TimelineItem
            key={event.id}
            event={event}
            overrideMessage={override}
            last={isLast}
            compact={compact}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyIconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lightBlue,
  },
  emptyTextCol: {
    flex: 1,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
