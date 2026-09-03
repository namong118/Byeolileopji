import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';

type Tone = 'info' | 'error';

interface NoticeProps {
  message: string;
  tone?: Tone;
}

/** 로딩/오류 등 가벼운 안내 문구 박스. */
export function Notice({ message, tone = 'info' }: NoticeProps) {
  const isError = tone === 'error';
  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: isError
            ? colors.status.CHECK.bg
            : colors.surfaceMuted,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: isError ? colors.status.CHECK.fg : colors.textSecondary },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  text: {
    ...typography.body,
  },
});
