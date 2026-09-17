import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { colors } from '../../src/constants/theme';
import { labels } from '../../src/constants/strings';

type IoniconName = keyof typeof Ionicons.glyphMap;

/**
 * 실기기(Galaxy S24, Android)에서 tabBarIcon이 반환하는 아이콘을 plain
 * `View`로 감싸면(이전의 active pill 구현) focused 여부와 무관하게 아이콘
 * 글리프가 그려지지 않는 문제가 실기기 테스트로 확인됐다. 원인 후보(react-
 * native-screens freeze/unfreeze 등)는 실기기로 반증됐으므로 결론짓지 않고,
 * 검증된 대로 tabBarIcon은 항상 Ionicons를 wrapper 없이 직접 반환한다.
 * active 배경(pill)은 별도로 재도입하지 않는다 — 아이콘 표시가 우선.
 */
function TabIcon({
  focused,
  size,
  activeName,
  inactiveName,
}: {
  focused: boolean;
  size: number;
  activeName: IoniconName;
  inactiveName: IoniconName;
}) {
  return (
    <Ionicons
      name={focused ? activeName : inactiveName}
      size={size}
      color={focused ? colors.accent : colors.textSecondary}
    />
  );
}

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
          tabBarIcon: (props) => (
            <TabIcon {...props} activeName="home" inactiveName="home-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="timeline"
        options={{
          title: labels.timelineTab,
          tabBarIcon: (props) => (
            <TabIcon {...props} activeName="time" inactiveName="time-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="developer"
        options={{
          title: labels.developerTab,
          tabBarIcon: (props) => (
            <TabIcon
              {...props}
              activeName="construct"
              inactiveName="construct-outline"
            />
          ),
          // Phase 5 STEP 5.3-C — production 빌드에서는 탭 자체를 숨긴다.
          // (developer.tsx 자체도 __DEV__ 가 아니면 <Redirect> 하므로 이중으로 차단된다.)
          href: __DEV__ ? undefined : null,
        }}
      />
    </Tabs>
  );
}
