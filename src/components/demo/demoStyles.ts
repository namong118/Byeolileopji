/** 웹 데모 공통 카드 스타일 — 1px 연회색 테두리 + 큰 둥근 모서리 + 부드러운 그림자 */
import type { ViewStyle } from 'react-native';

import { colors } from '../../constants/theme';

export const DEMO_CARD_RADIUS = 32;

export const demoCard: ViewStyle = {
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: DEMO_CARD_RADIUS,
  shadowColor: colors.textPrimary,
  shadowOffset: { width: 0, height: 16 },
  shadowOpacity: 0.08,
  shadowRadius: 40,
};
