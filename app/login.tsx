import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark, Notice, PressableButton } from '../src/components';
import { brand } from '../src/constants/strings';
import { colors, radius, spacing, typography } from '../src/constants/theme';
import { useAuthStore } from '../src/stores/authStore';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useAuthStore((s) => s.signIn);
  const signingIn = useAuthStore((s) => s.signingIn);
  const authError = useAuthStore((s) => s.authError);
  const clearAuthError = useAuthStore((s) => s.clearAuthError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0 && !signingIn;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void signIn(email.trim(), password);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}>
      <View style={styles.brandBlock}>
        <BrandMark size={88} />
        <Text style={styles.brand}>{brand.name}</Text>
        <Text style={styles.message}>{brand.message}</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="이메일"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (authError) clearAuthError();
          }}
        />
        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoComplete="password"
          secureTextEntry
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (authError) clearAuthError();
          }}
          onSubmitEditing={handleSubmit}
        />

        {authError ? <Notice message={authError} tone="error" /> : null}

        <PressableButton
          label={signingIn ? '로그인 중…' : '로그인'}
          variant="solid"
          onPress={handleSubmit}
          style={styles.submit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.screen,
  },
  brandBlock: {
    alignItems: 'center',
  },
  brand: {
    ...typography.hero,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  form: {
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  submit: {
    marginTop: spacing.sm,
  },
});
