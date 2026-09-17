import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Card,
  Notice,
  ScreenScrollView,
  SectionHeader,
  StatusHero,
  SummaryCard,
  TimelineList,
} from '../../src/components';
import { labels } from '../../src/constants/strings';
import { colors, fontFamily, spacing, typography } from '../../src/constants/theme';
import { useCareStore } from '../../src/stores/careStore';
import { presentDeviceSummaryCard } from '../../src/utils/deviceHealthText';
import { buildHomeSummary } from '../../src/utils/homeSummary';
import { buildTodayActivitySummary } from '../../src/utils/todayActivity';
import {
  formatClock,
  formatKoreanDate,
  formatRelativeDetailed,
} from '../../src/utils/time';

export default function HomeScreen() {
  const router = useRouter();
  const statusText = useCareStore((s) => s.statusText);
  const careTarget = useCareStore((s) => s.careTarget);
  const todayEvents = useCareStore((s) => s.todayEvents);
  const events = useCareStore((s) => s.events);
  const lastActivity = useCareStore((s) => s.lastActivity);
  const loading = useCareStore((s) => s.loading);
  const loadError = useCareStore((s) => s.loadError);
  const deviceHealth = useCareStore((s) => s.deviceHealth);
  const deviceHealthOverride = useCareStore((s) => s.deviceHealthOverride);

  const summary = useMemo(
    () => buildHomeSummary(events, lastActivity),
    [events, lastActivity],
  );
  const todayActivity = useMemo(
    () => buildTodayActivitySummary(events),
    [events],
  );
  const today = useMemo(() => formatKoreanDate(new Date()), []);

  const effectiveDeviceHealth = deviceHealthOverride ?? deviceHealth.health;

  // ── "한눈에 보기" 2×2 그리드 — 항상 4칸, 값이 없으면 차분한 기본 문구를 쓴다
  //   (임의 데이터 생성 금지 — 빈 상태를 정직하게 표현할 뿐).
  const deviceCard = presentDeviceSummaryCard(effectiveDeviceHealth);
  const recentActivityValue = lastActivity
    ? formatRelativeDetailed(lastActivity.occurredAt)
    : '아직 없음';
  const lastCheckedValue = deviceHealth.lastSeenAt
    ? formatClock(deviceHealth.lastSeenAt)
    : '확인 전';

  return (
    <ScreenScrollView>
      <Text style={styles.personHeadline}>{careTarget.name}님의 오늘</Text>
      <Text style={styles.dateText}>{today}</Text>

      <View style={styles.heroWrap}>
        <StatusHero
          tone={statusText.tone}
          headline={statusText.headline}
          subtext={statusText.detail}
          lastActivityLabel={
            summary.lastActivityText ? labels.lastActivity : undefined
          }
          lastActivityValue={summary.lastActivityText}
        />
      </View>

      {!loadError ? (
        <>
          <SectionHeader title={labels.atGlance} style={styles.gridHeader} />
          <View style={styles.grid}>
            <View style={styles.gridRow}>
              <SummaryCard
                icon="walk-outline"
                label={labels.lastActivity}
                value={recentActivityValue}
                secondary={lastActivity?.location}
                tone="mint"
              />
              <SummaryCard
                icon="home-outline"
                label={labels.homeDevice}
                value={deviceCard.value}
                secondary={deviceCard.secondary}
                muted
              />
            </View>
            <View style={styles.gridRow}>
              <SummaryCard
                icon="list-outline"
                label={labels.todayActivity}
                value={`${todayActivity.count}회`}
              />
              <SummaryCard
                icon="time-outline"
                label={labels.lastChecked}
                value={lastCheckedValue}
              />
            </View>
          </View>
        </>
      ) : null}

      {loadError ? (
        <View style={styles.banner}>
          <Notice message={loadError} tone="error" />
        </View>
      ) : loading ? (
        <View style={styles.banner}>
          <Notice message="오늘의 기록을 불러오고 있어요." />
        </View>
      ) : null}

      <SectionHeader
        title={labels.homeFlow}
        style={styles.timelineHeader}
        action={
          <Text style={styles.link} onPress={() => router.push('/timeline')}>
            {labels.viewAllTimeline}
          </Text>
        }
      />
      <Card variant={todayEvents.length > 0 ? 'elevated' : 'tinted'}>
        <TimelineList events={todayEvents} limit={4} compact />
      </Card>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  personHeadline: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  dateText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  heroWrap: {
    marginTop: spacing.sm,
  },
  gridHeader: {
    marginTop: 10,
    marginBottom: spacing.xs,
  },
  grid: {
    gap: spacing.sm,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  banner: {
    marginTop: spacing.sm,
  },
  timelineHeader: {
    marginTop: 10,
  },
  link: {
    ...typography.caption,
    fontFamily: fontFamily.semiBold,
    color: colors.accent,
  },
});
