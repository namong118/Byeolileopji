import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Card,
  Notice,
  PressableButton,
  ScreenScrollView,
  SectionHeader,
} from '../../src/components';
import { colors, radius, spacing, typography } from '../../src/constants/theme';
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

const DATA_SOURCE_LABEL: Record<string, string> = {
  firebase: 'Firebase Firestore (영속 저장)',
  memory: 'In-Memory (앱 종료 시 초기화)',
};

export default function DeveloperScreen() {
  const simulateEvent = useCareStore((s) => s.simulateEvent);
  const setStatus = useCareStore((s) => s.setStatus);
  const status = useCareStore((s) => s.status);
  const dataSource = useCareStore((s) => s.dataSource);
  const realtime = useCareStore((s) => s.realtime);
  const actionError = useCareStore((s) => s.actionError);
  const reload = useCareStore((s) => s.reload);
  const [lastLog, setLastLog] = useState<string>();
  const [detailError, setDetailError] = useState<string>();

  return (
    <ScreenScrollView>
      <Text style={styles.title}>개발자 시뮬레이션</Text>
      <Text style={styles.subtitle}>
        실제 센서/서버 대신 목업 이벤트를 발생시켜 앱 흐름을 확인합니다.
        Production 빌드에서는 이 화면을 숨깁니다.
      </Text>

      <View style={styles.sourceBadge}>
        <Text style={styles.sourceLabel}>Data Source</Text>
        <Text style={styles.sourceValue}>
          {DATA_SOURCE_LABEL[dataSource] ?? dataSource}
        </Text>
        <Text style={styles.sourceSub}>
          실시간 구독 {realtime ? '연결됨' : '미사용'}
        </Text>
      </View>

      <SectionHeader title="이벤트 발생" />
      <View style={styles.grid}>
        {SIMULATION_BUTTONS.map((btn) => (
          <PressableButton
            key={btn.key}
            label={btn.label}
            style={styles.gridItem}
            onPress={async () => {
              setDetailError(undefined);
              try {
                const input = btn.build();
                const created = await simulateEvent(input);
                setLastLog(
                  `${formatClock(created.occurredAt)} · ${
                    presentEvent(created).shortMessage
                  }`,
                );
              } catch (error) {
                setDetailError(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          />
        ))}
      </View>

      {actionError ? (
        <View style={styles.errorBlock}>
          <Notice message={actionError} tone="error" />
          {detailError ? (
            <Text style={styles.detailError}>개발용 상세: {detailError}</Text>
          ) : null}
          <PressableButton
            label="다시 불러오기"
            onPress={() => void reload()}
            style={styles.retry}
          />
        </View>
      ) : null}

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
  sourceBadge: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  sourceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sourceValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: 2,
  },
  sourceSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
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
  errorBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  detailError: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retry: {
    alignSelf: 'flex-start',
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
