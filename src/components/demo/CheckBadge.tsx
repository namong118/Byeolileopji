import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, spacing } from '../../constants/theme';

/** "확인이 필요해요" 배지 — 화면 표시 전용 (서버 상태 판정과 무관) */
export function CheckBadge() {
  return (
    <View style={styles.badge} accessibilityRole="alert">
      <Text style={styles.text}>확인이 필요해요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.status.CHECK.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    fontFamily: fontFamily.semiBold,
    fontSize: 13,
    color: colors.status.CHECK.fg,
  },
});
