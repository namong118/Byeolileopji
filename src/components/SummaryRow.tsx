import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../constants/theme';

interface SummaryRowProps {
  label: string;
  value: string;
  /** 주의가 필요한 항목이면 살짝 강조 */
  highlight?: boolean;
  last?: boolean;
}

export function SummaryRow({ label, value, highlight, last }: SummaryRowProps) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[styles.value, highlight && { color: colors.status.CHECK.fg }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  value: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
});
