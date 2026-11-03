/**
 * 웹 데모 레이아웃. 데모 모드이고 화면 폭이 1024px 이상일 때만
 * 가운데 폰 프레임(기존 앱) + 오른쪽 실시간 이벤트 로그 패널을 그린다.
 * 그 외(모바일 앱, 데모 아님, 1024px 미만)는 children 을 그대로 돌려준다.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { isDemoMode } from '../../config/demoMode';
import { colors } from '../../constants/theme';
import { DemoEventLog } from './DemoEventLog';

export const DEMO_WIDE_MIN_WIDTH = 1024;

export function DemoWebShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  if (!isDemoMode || width < DEMO_WIDE_MIN_WIDTH) return <>{children}</>;
  return (
    <View style={styles.page}>
      <View style={styles.phone}>{children}</View>
      <DemoEventLog />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    backgroundColor: '#DDE3E8',
  },
  phone: {
    width: 390,
    height: 844,
    borderRadius: 40,
    borderWidth: 10,
    borderColor: '#1B1F24',
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
});
