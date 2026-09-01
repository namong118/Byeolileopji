import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  PressableButton,
  ScreenScrollView,
  SectionHeader,
} from '../../src/components';
import { colors, spacing, typography } from '../../src/constants/theme';
import { SIMULATION_BUTTONS } from '../../src/mock/simulations';
import { useCareStore } from '../../src/stores/careStore';
import type { CareStatus } from '../../src/types/status';
import { presentEvent } from '../../src/utils/eventPresenter';
import { formatClock } from '../../src/utils/time';

const STATUS_BUTTONS: { label: string; value: CareStatus }[] = [
  { label: '정상', value: 'NORMAL' },
  { label: '확인 필요', value: 'CHECK' },
  { label: '긴급', value: 'EMERGENCY' },
];

export default function DeveloperScreen() {
  const simulateEvent = useCareStore((s) => s.simulateEvent);
  const setStatus = useCareStore((s) => s.setStatus);
  const status = useCareStore((s) => s.status);
  const [lastLog, setLastLog] = useState<string>();

  return (
    <ScreenScrollView>
      <Text style={styles.title}>개발자 시뮬레이션</Text>
      <Text style={styles.subtitle}>
        실제 센서/서버 대신 목업 이벤트를 발생시켜 앱 흐름을 확인합니다.
        Production 빌드에서는 이 화면을 숨깁니다.
      </Text>

      <SectionHeader title="이벤트 발생" />
      <View style={styles.grid}>
        {SIMULATION_BUTTONS.map((btn) => (
          <PressableButton
            key={btn.key}
            label={btn.label}
            style={styles.gridItem}
            onPress={async () => {
              const input = btn.build();
              const created = await simulateEvent(input);
              setLastLog(
                `${formatClock(created.occurredAt)} · ${
                  presentEvent(created).shortMessage
                }`,
              );
            }}
          />
        ))}
      </View>

      <SectionHeader title="상태 변경" />
      <View style={styles.statusRow}>
        {STATUS_BUTTONS.map((btn) => (
          <PressableButton
            key={btn.value}
            label={btn.label}
            variant={status === btn.value ? 'solid' : 'outline'}
            style={styles.statusItem}
            onPress={() => setStatus(btn.value)}
          />
        ))}
      </View>

      <SectionHeader title="마지막 동작" />
      <Card>
        <Text style={styles.log}>
          {lastLog ?? '아직 발생시킨 이벤트가 없어요.'}
        </Text>
      </Card>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: '45%',
  },
  statusRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statusItem: {
    flex: 1,
  },
  log: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
});
