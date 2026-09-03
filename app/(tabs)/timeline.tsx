import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Notice,
  PressableButton,
  ScreenScrollView,
  TimelineList,
} from '../../src/components';
import { colors, spacing, typography } from '../../src/constants/theme';
import { useCareStore } from '../../src/stores/careStore';

export default function TimelineScreen() {
  const todayEvents = useCareStore((s) => s.todayEvents);
  const careTarget = useCareStore((s) => s.careTarget);
  const loading = useCareStore((s) => s.loading);
  const loadError = useCareStore((s) => s.loadError);
  const reload = useCareStore((s) => s.reload);

  return (
    <ScreenScrollView>
      <Text style={styles.title}>오늘의 기록</Text>
      <Text style={styles.subtitle}>
        {careTarget.name} 님의 오늘 하루예요.
      </Text>

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
        <Card style={styles.card}>
          <TimelineList events={todayEvents} markFirstActivity />
        </Card>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  notice: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  card: {
    marginTop: spacing.lg,
  },
});
