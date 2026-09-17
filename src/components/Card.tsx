import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, shadows, spacing } from '../constants/theme';

type CardVariant = 'default' | 'elevated' | 'tinted';

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  /**
   * default: 기존 그대로(흰 배경 + 얇은 border, 그림자 없음) — 지정하지 않으면
   *   이 값이라 다른 화면(Login 등)에 예상치 못한 변화가 생기지 않는다.
   * elevated: border 없음 + 매우 옅은 shadow(떠 있는 느낌, Home/Timeline 전용).
   * tinted: border/shadow 없음, 옅은 Light Blue 배경(빈 상태 등 보조 카드용).
   */
  variant?: CardVariant;
}

/** 앱 전반의 기본 카드 컨테이너. 그림자는 최소한만 사용한다. */
export function Card({ children, style, variant = 'default' }: CardProps) {
  return (
    <View style={[styles.card, styles[variant], style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  default: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  elevated: {
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  tinted: {
    backgroundColor: colors.lightBlue,
  },
});
