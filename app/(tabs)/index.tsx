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
import { buildHomeSummary } from '../../src/utils/homeSummary';

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

  // 기기 축이 offline 일 때만 별도 안내 (사람 축 Hero 와 독립).
  // Phase 4.1a 실제 데이터에서는 heartbeat 가 없어 offline 이 나오지 않는다.
  const effectiveDeviceHealth = deviceHealthOverride ?? deviceHealth.health;

  return (
    <ScreenScrollView>
      <Text style={styles.brand}>{brand.name}</Text>
      <Text style={styles.targetName}>
        {careTarget.name}
        <Text style={styles.relation}>{`  ${careTarget.relation}`}</Text>
      </Text>

      <View style={styles.heroWrap}>
        <StatusHero
          tone={statusText.tone}
          emoji={statusText.emoji}
          headline={statusText.headline}
          subtext={statusText.detail}
        />
      </View>

      {loadError ? (
        <View style={styles.banner}>
          <Notice message={loadError} tone="error" />
        </View>
      ) : loading ? (
        <View style={styles.banner}>
          <Notice message="오늘의 기록을 불러오고 있어요." />
        </View>
      ) : null}

      {effectiveDeviceHealth === 'offline' ? (
        <View style={styles.banner}>
          <Notice
            message="센서와 연결이 끊겼어요. 계속되면 직접 확인해 주세요."
            tone="error"
          />
        </View>
      ) : null}

      <View style={styles.pairRow}>
        <Card style={styles.pairCard}>
          <Text style={styles.pairLabel}>{labels.lastActivity}</Text>
          <Text style={styles.pairValue}>
            {summary.lastActivityDetail ?? '기록 없음'}
          </Text>
        </Card>
        <Card style={styles.pairCard}>
          <Text style={styles.pairLabel}>{labels.currentPresence}</Text>
          <Text style={styles.pairValue}>{summary.presenceText}</Text>
        </Card>
      </View>

      <SectionHeader title={labels.todayStatus} />
      <Card>
        <SummaryRow
          label="생활 활동"
          value={summary.lastActivityDetail ?? '기록 없음'}
        />
        <SummaryRow label="외출 / 귀가" value={summary.presenceText} />
        <SummaryRow
          label="복약"
          value={summary.medicationText}
          highlight={summary.medicationTakenCount < summary.medicationPlanned}
        />
        <SummaryRow label="스마트워치" value={summary.watchText} />
        <SummaryRow
          label="SOS"
          value={summary.sosText}
          highlight={summary.hasSos}
          last
        />
      </Card>

      <SectionHeader
        title={labels.todayTimeline}
        action={
          <Text style={styles.link} onPress={() => router.push('/timeline')}>
            {labels.viewAllTimeline}
          </Text>
        }
      />
      <Card>
        <TimelineList events={todayEvents} limit={4} />
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
  heroWrap: {
    marginTop: spacing.lg,
  },
  banner: {
    marginTop: spacing.md,
  },
  pairRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  pairCard: {
    flex: 1,
  },
  pairLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  pairValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  link: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
});
