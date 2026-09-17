import { type ReactNode } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../constants/theme';

interface ScreenScrollViewProps {
  children: ReactNode;
}

/** 화면 공통 스크롤 컨테이너: 밝은 배경 + 넉넉한 좌우 여백. */
export function ScreenScrollView({ children }: ScreenScrollViewProps) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.sm,
          paddingBottom: insets.bottom + spacing.xxl,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.screen,
  },
});
