import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, spacing, typography } from '../constants/theme';

interface SectionHeaderProps {
  title: string;
  action?: React.ReactNode;
  /** 화면별로 위/아래 여백을 좁힐 때만 사용 (기본 여백은 그대로 유지) */
  style?: ViewStyle;
}

export function SectionHeader({ title, action, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.xl,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textSecondary,
  },
});
