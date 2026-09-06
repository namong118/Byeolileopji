import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Card,
  Notice,
  ScreenScrollView,
  SectionHeader,
  StatusHero,
  SummaryRow,
  TimelineList,
} from '../../src/components';
import { brand, labels } from '../../src/constants/strings';
import { colors, spacing, typography } from '../../src/constants/theme';
import { useCareStore } from '../../src/stores/careStore';
import {
  presentSensorRow,
  type StatusRow,
} from '../../src/utils/deviceHealthText';
import { buildHomeSummary } from '../../src/utils/homeSummary';
import { buildTodayActivitySummary } from '../../src/utils/todayActivity';
import { formatKoreanDate } from '../../src/utils/time';

export default function HomeScreen() {
  const router = useRouter();
  const statusText = useCareStore((s) => s.statusText);
  const personStatus = useCareStore((s) => s.status);
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

  // ── 통합 정보 카드: Hero 를 본 다음 근거를 한 카드에서 확인 ──────────────
  //   마지막 활동 / 센서 연결 / 오늘 활동. 값이 없는 행은 넣지 않는다.
  //   "오늘 활동" 은 항상 넣는다 (0 건이면 "아직 확인된 활동이 없어요").
  const infoRows: StatusRow[] = [];
  if (summary.lastActivityText) {
    infoRows.push({
      label: labels.lastActivity,
      value: summary.lastActivityText,
    });
  }
  const sensorRow = presentSensorRow(effectiveDeviceHealth, personStatus);
  if (sensorRow) infoRows.push(sensorRow);
  infoRows.push({ label: labels.todayActivity, value: todayActivity.text });

  return (
    <ScreenScrollView>
      <Text style={styles.brand}>{brand.name}</Text>
      <Text style={styles.targetName}>
        {careTarget.name}
        <Text style={styles.relation}>{`  ${careTarget.relation}`}</Text>
      </Text>
      <Text style={styles.date}>{today}</Text>

      <View style={styles.heroWrap}>
        <StatusHero
          tone={statusText.tone}
          emoji={statusText.emoji}
          headline={statusText.headline}
          subtext={statusText.detail}
        />
      </View>

      {!loadError ? (
        <Card style={styles.infoCard}>
          {infoRows.map((row, index) => (
            <SummaryRow
              key={row.label}
              label={row.label}
              value={row.value}
              last={index === infoRows.length - 1}
            />
          ))}
        </Card>
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
        title={labels.todayTimeline}
        style={styles.timelineHeader}
        action={
          <Text style={styles.link} onPress={() => router.push('/timeline')}>
            {labels.viewAllTimeline}
          </Text>
        }
      />
      <Card>
        <TimelineList events={todayEvents} limit={4} compact />
      </Card>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  brand: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  targetName: {
    ...typography.title,
    color: colors.textPrimary,
  },
  relation: {
    ...typography.body,
    color: colors.textSecondary,
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  heroWrap: {
    marginTop: spacing.md,
  },
  infoCard: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  banner: {
    marginTop: spacing.md,
  },
  timelineHeader: {
    marginTop: spacing.lg,
  },
  link: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
});
