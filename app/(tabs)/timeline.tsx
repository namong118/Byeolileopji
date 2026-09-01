import { StyleSheet, Text } from 'react-native';

import {
  Card,
  ScreenScrollView,
  TimelineList,
} from '../../src/components';
import { colors, spacing, typography } from '../../src/constants/theme';
import { useCareStore } from '../../src/stores/careStore';

export default function TimelineScreen() {
  const todayEvents = useCareStore((s) => s.todayEvents);
  const careTarget = useCareStore((s) => s.careTarget);

  return (
    <ScreenScrollView>
      <Text style={styles.title}>오늘의 기록</Text>
      <Text style={styles.subtitle}>
        {careTarget.name} 님의 오늘 하루예요.
      </Text>

      <Card style={styles.card}>
        <TimelineList events={todayEvents} markFirstActivity />
      </Card>
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
  card: {
    marginTop: spacing.lg,
  },
});
