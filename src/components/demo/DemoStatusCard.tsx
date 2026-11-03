/**
 * 웹 데모 모드에서 홈 StatusHero 자리를 대신한다.
 * Cron 이 데모 보호대상을 판정하지 않으므로 서버 상태(NORMAL/CHECK/EMERGENCY)를 보여주지 않는다.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadows, spacing, typography } from '../../constants/theme';
import { postureMessage } from '../../utils/posture';
import { formatClock } from '../../utils/time';
import { CheckBadge } from './CheckBadge';
import { usePostureAlert } from './usePostureAlert';

export function DemoStatusCard() {
  const alert = usePostureAlert();
  const latest = alert.latest;
  return (
    <View style={styles.card}>
      <Text style={styles.mode}>데모 모드 · XIAO 자세 인식</Text>
      <Text style={styles.headline}>
        {latest ? postureMessage(latest.location, latest.posture) : '자세 정보를 기다리고 있어요.'}
      </Text>
      {latest ? (
        <Text style={styles.sub}>
          {formatClock(latest.occurredAt)} 기준
          {latest.confidence !== undefined
            ? ` · 신뢰도 ${Math.round(latest.confidence * 100)}%`
            : ''}
        </Text>
      ) : null}
      {alert.needsCheck ? (
        <View style={styles.badgeWrap}>
          <CheckBadge />
        </View>
      ) : null}
      <Text style={styles.note}>데모 이벤트는 실제 상태 판정·알림에 쓰이지 않아요.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.soft,
  },
  mode: { ...typography.caption, color: colors.accent },
  headline: { ...typography.statusHeadline, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary },
  badgeWrap: { marginTop: spacing.xs },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
});
