/** 웹 데모 상단 헤더 — 제목 + Firestore 구독 상태 점 + 마지막 이벤트 시각 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, spacing, typography } from '../../constants/theme';
import { isStreamStale } from '../../services/syncState';
import { useCareStore } from '../../stores/careStore';
import { formatClock } from '../../utils/time';
import { usePostureAlert } from './usePostureAlert';

export function DemoHeader() {
  const eventsSync = useCareStore((s) => s.eventsSync);
  const alert = usePostureAlert(); // 1초 타이머 — 연결 상태도 같은 주기로 다시 계산된다
  const now = new Date();
  const connected = Boolean(
    eventsSync && eventsSync.lastServerSyncAt && !isStreamStale(eventsSync, now),
  );
  const lastAt = alert.latest?.occurredAt;

  return (
    <View style={styles.header}>
      <Text style={styles.title}>
        별일없지 <Text style={styles.titleSub}>· XIAO 자세 인식 데모</Text>
      </Text>
      <View style={styles.status}>
        <View style={[styles.dot, { backgroundColor: connected ? colors.green : colors.textSecondary }]} />
        <Text style={styles.statusText}>{connected ? '실시간 연결' : '연결 끊김'}</Text>
        <Text style={styles.divider}>|</Text>
        <Text style={styles.statusText}>
          마지막 이벤트 {lastAt ? formatClock(lastAt) : '없음'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  title: { ...typography.title, color: colors.textPrimary },
  titleSub: { fontFamily: fontFamily.medium, color: colors.textSecondary },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { ...typography.caption, color: colors.textSecondary },
  divider: { ...typography.caption, color: colors.border },
});
