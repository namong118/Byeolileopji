/** 웹 데모 오른쪽 패널 — 실시간 자세 이벤트 로그 (시각, 방, 자세, confidence) */
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, spacing, typography } from '../../constants/theme';
import { useCareStore } from '../../stores/careStore';
import type { CareEvent } from '../../types/events';
import { POSTURE_LABEL, readPosture, type PostureReading } from '../../utils/posture';
import { formatClock } from '../../utils/time';
import { CheckBadge } from './CheckBadge';
import { usePostureAlert } from './usePostureAlert';

const MAX_ROWS = 50;

export function DemoEventLog() {
  const events = useCareStore((s) => s.events);
  const alert = usePostureAlert();
  const rows: { e: CareEvent; r: PostureReading }[] = [];
  for (const e of events) {
    const r = readPosture(e);
    if (r) rows.push({ e, r });
  }
  rows.sort((a, b) => Date.parse(b.e.occurredAt) - Date.parse(a.e.occurredAt));

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>실시간 이벤트 로그</Text>
      <Text style={styles.sub}>XIAO ESP32-S3 Sense → Worker → Firestore</Text>
      {alert.needsCheck ? (
        <View style={styles.badgeWrap}>
          <CheckBadge />
          <Text style={styles.sub}>
            {`${alert.latest?.location ?? '-'}에서 ${Math.floor(alert.lyingElapsedMs / 1000)}초째 누워 있음`}
          </Text>
        </View>
      ) : null}
      <View style={[styles.row, styles.head]}>
        <Text style={[styles.cell, styles.time, styles.headText]}>시각</Text>
        <Text style={[styles.cell, styles.headText]}>방</Text>
        <Text style={[styles.cell, styles.headText]}>자세</Text>
        <Text style={[styles.cell, styles.conf, styles.headText]}>confidence</Text>
      </View>
      <ScrollView style={styles.list}>
        {rows.length === 0 ? <Text style={styles.empty}>아직 자세 이벤트가 없어요.</Text> : null}
        {rows.slice(0, MAX_ROWS).map(({ e, r }) => (
          <View key={e.id} style={styles.row}>
            <Text style={[styles.cell, styles.time]}>{formatClock(e.occurredAt)}</Text>
            <Text style={styles.cell}>{e.location ?? '-'}</Text>
            <Text style={styles.cell}>{POSTURE_LABEL[r.posture]}</Text>
            <Text style={[styles.cell, styles.conf]}>
              {r.confidence !== undefined ? r.confidence.toFixed(2) : '-'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 380,
    height: 844,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary },
  badgeWrap: { gap: spacing.xs },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  head: { borderBottomColor: colors.textSecondary },
  headText: { fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  cell: { flex: 1, ...typography.caption, color: colors.textPrimary },
  time: { flex: 1.2 },
  conf: { textAlign: 'right' },
  empty: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.md },
});
