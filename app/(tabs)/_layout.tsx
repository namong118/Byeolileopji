import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors } from '../../src/constants/theme';
import { labels } from '../../src/constants/strings';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: labels.homeTab,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: labels.timelineTab,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="developer"
        options={{
          title: labels.developerTab,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="construct-outline" color={color} size={size} />
          ),
          // Phase 5 STEP 5.3-C — production 빌드에서는 탭 자체를 숨긴다.
          // (developer.tsx 자체도 __DEV__ 가 아니면 <Redirect> 하므로 이중으로 차단된다.)
          href: __DEV__ ? undefined : null,
        }}
      />
    </Tabs>
  );
}
