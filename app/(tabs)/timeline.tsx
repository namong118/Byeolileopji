import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  Card,
  Notice,
  PressableButton,
  ScreenScrollView,
  TimelineList,
} from '../../src/components';
import { colors, radius, spacing, typography } from '../../src/constants/theme';
import { useCareStore } from '../../src/stores/careStore';
import { buildTodayActivitySummary } from '../../src/utils/todayActivity';
import { formatKoreanDate, formatRelativeDetailed } from '../../src/utils/time';

export default function TimelineScreen() {
  const todayEvents = useCareStore((s) => s.todayEvents);
  const lastActivity = useCareStore((s) => s.lastActivity);
  const loading = useCareStore((s) => s.loading);
  const loadError = useCareStore((s) => s.loadError);
  const reload = useCareStore((s) => s.reload);

  const today = useMemo(() => formatKoreanDate(new Date()), []);
  const todayActivity = useMemo(
    () => buildTodayActivitySummary(todayEvents),
    [todayEvents],
  );
  const hasEvents = todayEvents.length > 0;
  const recentActivityValue = lastActivity
    ? formatRelativeDetailed(lastActivity.occurredAt)
    : '아직 없음';

  return (
    <ScreenScrollView>
      <Text style={styles.title}>오늘의 기록</Text>
      <Text style={styles.dateText}>{today}</Text>

      <View style={styles.summaryPill}>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryBadge, { backgroundColor: colors.mint }]}>
            <Ionicons name="walk-outline" size={16} color={colors.green} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>오늘 활동</Text>
            <Text style={styles.summaryValue}>{todayActivity.count}회</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <View style={[styles.summaryBadge, { backgroundColor: colors.lightBlue }]}>
            <Ionicons name="time-outline" size={16} color={colors.blue} />
          </View>
          <View>
            <Text style={styles.summaryLabel}>최근 활동</Text>
            <Text style={styles.summaryValue}>{recentActivityValue}</Text>
          </View>
        </View>
      </View>

      {loading && todayEvents.length === 0 ? (
        <View style={styles.notice}>
          <Notice message="오늘의 기록을 불러오고 있어요." />
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.notice}>
          <Notice message={loadError} tone="error" />
          <PressableButton
            label="다시 시도"
            onPress={() => void reload()}
            style={styles.retry}
          />
        </View>
      ) : null}

      {!loading && !loadError ? (
        <Card
          style={styles.card}
          variant={hasEvents ? 'elevated' : 'tinted'}
        >
          <TimelineList events={todayEvents} markFirstActivity />
        </Card>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  dateText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  summaryItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  summaryValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: 1,
  },
  summaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  notice: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  card: {
    marginTop: spacing.xl,
  },
});
