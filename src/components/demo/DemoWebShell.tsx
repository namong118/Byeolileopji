/**
 * 웹 데모 레이아웃. 데모 모드이고 화면 폭이 1024px 이상일 때만
 * 상단 헤더 + 가운데 폰 카드(기존 앱) + 오른쪽 패널(현재 상태 · 이벤트 로그)을 그린다.
 * 그 외(모바일 앱, 데모 아님, 1024px 미만)는 children 을 그대로 돌려준다.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

import { isDemoMode } from '../../config/demoMode';
import { colors } from '../../constants/theme';
import { DemoEventLog } from './DemoEventLog';
import { DemoHeader } from './DemoHeader';
import { demoCard } from './demoStyles';

export const DEMO_WIDE_MIN_WIDTH = 1024;

/** 폰 프레임 안의 앱에 주입하는 가짜 safe area (실제 폰의 상태바·홈 인디케이터 자리) */
export const DEMO_FRAME_INSETS: EdgeInsets = { top: 24, bottom: 16, left: 0, right: 0 };

const DemoFrameContext = createContext(false);

/** 웹 데모 폰 프레임(폭 1024px 이상) 안에서 렌더링 중인가. 그 외에는 항상 false. */
export function useInDemoFrame(): boolean {
  return useContext(DemoFrameContext);
}

const PHONE_WIDTH = 390;
const PHONE_MAX_HEIGHT = 844;
const PHONE_MIN_HEIGHT = 640;
const HEADER_SPACE = 120; // 헤더 + 위아래 여백

// 웹 전용 CSS 그라데이션 (react-native-web 이 backgroundImage 를 그대로 CSS 로 넘긴다)
const gradient = {
  backgroundImage: `linear-gradient(160deg, ${colors.lightBlue} 0%, ${colors.background} 45%, ${colors.mint} 100%)`,
} as unknown as ViewStyle;

export function DemoWebShell({ children }: { children: ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (!isDemoMode || width < DEMO_WIDE_MIN_WIDTH) return <>{children}</>;

  const frameHeight = Math.max(PHONE_MIN_HEIGHT, Math.min(PHONE_MAX_HEIGHT, height - HEADER_SPACE));
  const gap = width >= 1600 ? 72 : 48;
  const panelWidth = width >= 1600 ? 480 : 420;
  const contentWidth = PHONE_WIDTH + gap + panelWidth;

  return (
    <View style={[styles.page, gradient]}>
      <View style={{ width: contentWidth }}>
        <DemoHeader />
        <View style={[styles.row, { gap }]}>
          <View style={[demoCard, styles.phone, { height: frameHeight }]}>
            <DemoFrameContext.Provider value>
              <SafeAreaInsetsContext.Provider value={DEMO_FRAME_INSETS}>
                {children}
              </SafeAreaInsetsContext.Provider>
            </DemoFrameContext.Provider>
          </View>
          <DemoEventLog width={panelWidth} height={frameHeight} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingVertical: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  phone: {
    width: PHONE_WIDTH,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
});
