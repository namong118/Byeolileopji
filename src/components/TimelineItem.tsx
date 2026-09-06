import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../constants/theme';
import type { CareEvent } from '../types/events';
import { presentEvent } from '../utils/eventPresenter';
import { formatClock } from '../utils/time';

interface TimelineItemProps {
  event: CareEvent;
  /** 오늘의 첫 이벤트면 특별 문구를 쓸 수 있도록 */
  overrideMessage?: string;
  last?: boolean;
  /** 홈 미리보기: 행 간격을 줄여 더 많이 보이게 한다. 전체 탭에서는 false. */
  compact?: boolean;
}

export function TimelineItem({
  event,
  overrideMessage,
  last,
  compact,
}: TimelineItemProps) {
  const message = overrideMessage ?? presentEvent(event).message;

  return (
    <View style={styles.row}>
      <View style={styles.railColumn}>
        <View style={styles.dot} />
        {!last ? <View style={styles.line} /> : null}
      </View>
      <View
        style={[
          styles.content,
          compact && styles.contentCompact,
          last && styles.contentLast,
        ]}
      >
        <Text style={styles.time}>{formatClock(event.occurredAt)}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  railColumn: {
    alignItems: 'center',
    width: 24,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    paddingBottom: spacing.xl,
    marginLeft: spacing.md,
  },
  contentCompact: {
    paddingBottom: spacing.md,
  },
  contentLast: {
    paddingBottom: 0,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  message: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
