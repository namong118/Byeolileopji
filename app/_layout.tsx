import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

import { colors } from '../src/constants/theme';
import { useCareStore } from '../src/stores/careStore';
import { useAuthStore } from '../src/stores/authStore';
import { registerForCareStatusPush } from '../src/services/pushRegistration';

export default function RootLayout() {
  const init = useCareStore((s) => s.init);
  const teardown = useCareStore((s) => s.teardown);
  const initAuth = useAuthStore((s) => s.init);
  const teardownAuth = useAuthStore((s) => s.teardown);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.authLoading);

  useEffect(() => {
    void init();
    initAuth();
    return () => {
      teardown();
      teardownAuth();
    };
  }, [init, teardown, initAuth, teardownAuth]);

  useEffect(() => {
    // Phase 5 STEP 5.1 — 로그인 전에는 push token 을 등록하지 않는다.
    //   (Phase 4.4 STEP 1 에서는 로그인 개념이 없어 부팅 즉시 등록했다.)
    if (!user) return;
    // 실기기 + development build + google-services.json 이 있을 때만 성공한다.
    // 그 외에는 조용히 실패한다 (앱 실행을 막지 않는다).
    void registerForCareStatusPush();
  }, [user]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          {/* authLoading 중에는 두 guard 가 모두 false → 아무 화면도 활성화되지 않는다
              (보호자 화면이 잠깐 노출되는 것을 막는다). */}
          <Stack.Protected guard={!authLoading && !user}>
            <Stack.Screen name="login" />
          </Stack.Protected>
          <Stack.Protected guard={!authLoading && Boolean(user)}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
        {authLoading ? (
          <View style={[StyleSheet.absoluteFill, styles.loading]}>
            <ActivityIndicator color={colors.accent} />
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
  },
});
