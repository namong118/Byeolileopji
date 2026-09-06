import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../constants/theme';
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
      <Text style={styles.empty}>
        아직 오늘 기록이 없어요.{'\n'}활동이 확인되면 이곳에 표시됩니다.
      </Text>
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
    ...typography.body,
    color: colors.textSecondary,
    paddingVertical: spacing.lg,
  },
});
