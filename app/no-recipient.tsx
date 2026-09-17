import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark, PressableButton } from '../src/components';
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
      <BrandMark size={48} />
      <Text style={styles.message}>연결된 가족이 없어요</Text>
      <Text style={styles.hint}>
        보호할 가족이 연결되면{'\n'}이곳에서 하루의 안부를 확인할 수 있어요.
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
    paddingHorizontal: spacing.screen,
    alignItems: 'center',
  },
  message: {
    ...typography.hero,
    color: colors.textPrimary,
    marginTop: spacing.xl,
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
