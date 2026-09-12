import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableButton } from '../src/components';
import { brand } from '../src/constants/strings';
import { colors, spacing, typography } from '../src/constants/theme';
import { useAuthStore } from '../src/stores/authStore';
import { useGuardianStore } from '../src/stores/guardianStore';

/**
 * guardianLinks 조회 자체가 실패했을 때(permission-denied 등) 보여주는 화면
 * (Phase 5 STEP 5.2). "연결된 돌봄 대상이 없습니다"(app/no-recipient.tsx) 와는
 * 반드시 구분한다 — 하나는 "조회 성공, 링크 없음"이고 이 화면은 "조회 자체가 실패"다.
 */
export default function LinkErrorScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const linkError = useGuardianStore((s) => s.linkError);
  const resolveLink = useGuardianStore((s) => s.resolveLink);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}>
      <Text style={styles.brand}>{brand.name}</Text>
      <Text style={styles.message}>연결 정보를 불러오지 못했습니다.</Text>
      {linkError ? <Text style={styles.hint}>{linkError}</Text> : null}

      <PressableButton
        label="다시 시도"
        variant="solid"
        onPress={() => {
          if (user) void resolveLink(user.uid);
        }}
        style={styles.retry}
      />
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
  retry: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  logout: {
    marginTop: spacing.sm,
    alignSelf: 'stretch',
  },
});
