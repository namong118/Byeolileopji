import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

import { colors } from '../src/constants/theme';
import { useCareStore } from '../src/stores/careStore';
import { registerForCareStatusPush } from '../src/services/pushRegistration';

export default function RootLayout() {
  const init = useCareStore((s) => s.init);
  const teardown = useCareStore((s) => s.teardown);

  useEffect(() => {
    void init();
    // Phase 4.4 STEP 1 — 보호자 기기 FCM 토큰 등록 (fire-and-forget).
    //   실기기 + development build + google-services.json 이 있을 때만 성공한다.
    //   그 외에는 조용히 실패한다 (앱 실행을 막지 않는다).
    void registerForCareStatusPush();
    return () => teardown();
  }, [init, teardown]);

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
          <Stack.Screen name="(tabs)" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
