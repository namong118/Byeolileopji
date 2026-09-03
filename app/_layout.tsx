import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';

import { colors } from '../src/constants/theme';
import { useCareStore } from '../src/stores/careStore';

export default function RootLayout() {
  const init = useCareStore((s) => s.init);
  const teardown = useCareStore((s) => s.teardown);

  useEffect(() => {
    void init();
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
