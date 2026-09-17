import { useCallback, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { colors, spacing, typography } from '../src/constants/theme';
import { useCareStore } from '../src/stores/careStore';
import { useAuthStore } from '../src/stores/authStore';
import { useGuardianStore } from '../src/stores/guardianStore';
import { registerForCareStatusPush } from '../src/services/pushRegistration';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // 앱 전체 타이포그래피를 Pretendard로 통일 — 로딩 전에는 스플래시를 유지해
  // 시스템 기본 폰트(Roboto 등)가 잠깐 노출되는 FOUT을 막는다.
  const [fontsLoaded, fontError] = useFonts({
    'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.ttf'),
    'Pretendard-Medium': require('../assets/fonts/Pretendard-Medium.ttf'),
    'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.ttf'),
    'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.ttf'),
  });

  const onRootLayout = useCallback(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  const initAuth = useAuthStore((s) => s.init);
  const teardownAuth = useAuthStore((s) => s.teardown);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.authLoading);

  const resolveLink = useGuardianStore((s) => s.resolveLink);
  const resetLink = useGuardianStore((s) => s.reset);
  const careRecipientId = useGuardianStore((s) => s.careRecipientId);
  const linkLoading = useGuardianStore((s) => s.linkLoading);
  const linkError = useGuardianStore((s) => s.linkError);

  const initCare = useCareStore((s) => s.init);
  const teardownCare = useCareStore((s) => s.teardown);

  useEffect(() => {
    initAuth();
    return () => teardownAuth();
  }, [initAuth, teardownAuth]);

  // Phase 5 STEP 5.2 — 로그인 상태 변화 → guardian 관계 해석 / 정리.
  //   user 가 없으면(로그아웃 포함) careStore 구독·데이터소스·guardian 상태를 전부
  //   정리한다 — 다른 계정으로 재로그인해도 이전 사용자의 데이터가 남지 않게 한다.
  useEffect(() => {
    if (!user) {
      teardownCare();
      resetLink();
      return;
    }
    void resolveLink(user.uid);
  }, [user, resolveLink, resetLink, teardownCare]);

  // guardian 관계가 확정된 careRecipientId 로 careStore 를 초기화한다.
  // careRecipientId 가 null(연결 없음)이면 호출하지 않는다 — dev 값으로 몰래
  // fallback 하지 않는다.
  useEffect(() => {
    if (!careRecipientId) return;
    void initCare(careRecipientId);
  }, [careRecipientId, initCare]);

  useEffect(() => {
    // 로그인 + guardian 관계가 모두 확정된 후에만 push token 을 등록한다.
    if (!user || !careRecipientId) return;
    // 실기기 + development build + google-services.json 이 있을 때만 성공한다.
    // 그 외에는 조용히 실패한다 (앱 실행을 막지 않는다).
    void registerForCareStatusPush({ guardianUid: user.uid, careRecipientId });
  }, [user, careRecipientId]);

  const showLoadingOverlay = authLoading || (Boolean(user) && linkLoading);

  if (!fontsLoaded && !fontError) {
    // Pretendard 로딩 전에는 아무것도 그리지 않는다 — 스플래시 화면이 계속
    // 떠 있는 동안 시스템 기본 폰트가 잠깐 노출되는 것을 막는다.
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onRootLayout}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          {/* authLoading/linkLoading 중에는 네 guard 가 모두 false → 아무 화면도
              활성화되지 않는다 (보호자 화면이 잠깐 노출되는 것을 막는다).
              linkError 는 "조회 자체 실패"(permission-denied 등) 이고 no-recipient 는
              "조회 성공, 링크 없음" 이다 — 반드시 다른 화면으로 분리한다. */}
          <Stack.Protected guard={!authLoading && !user}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          <Stack.Protected
            guard={!authLoading && Boolean(user) && !linkLoading && Boolean(linkError)}
          >
            <Stack.Screen name="link-error" />
          </Stack.Protected>
          <Stack.Protected
            guard={
              !authLoading &&
              Boolean(user) &&
              !linkLoading &&
              !linkError &&
              !careRecipientId
            }
          >
            <Stack.Screen name="no-recipient" />
          </Stack.Protected>
          <Stack.Protected
            guard={
              !authLoading &&
              Boolean(user) &&
              !linkLoading &&
              !linkError &&
              Boolean(careRecipientId)
            }
          >
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
        {showLoadingOverlay ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>정보를 확인하고 있어요</Text>
          </View>
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
