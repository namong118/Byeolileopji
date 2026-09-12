import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableButton } from '../src/components';
import { brand } from '../src/constants/strings';
import { colors, spacing, typography } from '../src/constants/theme';
import { useAuthStore } from '../src/stores/authStore';

/**
 * 로그인은 했지만 guardianLinks 에 연결된 careRecipient 가 없을 때 보여주는 화면
 * (Phase 5 STEP 5.2). 크래시하거나 개발용 고정 대상으로 조용히 fallback 하지 않고
 * 명시적으로 상태를 알린다.
 */
export default function NoRecipientScreen() {
  const insets = useSafeAreaInsets();
  const signOutUser = useAuthStore((s) => s.signOutUser);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}>
      <Text style={styles.brand}>{brand.name}</Text>
      <Text style={styles.message}>연결된 돌봄 대상이 없습니다.</Text>
      <Text style={styles.hint}>
        이 계정에 연결된 돌봄 대상이 아직 없어요. 관리자에게 문의해 주세요.
      </Text>
      <PressableButton
        label="로그아웃"
        onPress={() => void signOutUser()}
        style={styles.logout}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  brand: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    letterSpacing: 1,
  },
  message: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
  hint: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  logout: {
    marginTop: spacing.xl,
  },
});
