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
import { careStatusConfig } from '../../src/config/careStatusConfig';
import { SIMULATION_BUTTONS } from '../../src/mock/simulations';
import { useCareStore } from '../../src/stores/careStore';
import type { CareStatus, DeviceHealth } from '../../src/types/status';
import { presentEvent } from '../../src/utils/eventPresenter';
import { formatClock } from '../../src/utils/time';

const STATUS_BUTTONS: { label: string; value: CareStatus }[] = [
  { label: '정상', value: 'NORMAL' },
  { label: '확인 필요', value: 'CHECK' },
  { label: '긴급', value: 'EMERGENCY' },
];

const DEVICE_HEALTH_BUTTONS: { label: string; value: DeviceHealth }[] = [
  { label: 'online', value: 'online' },
  { label: 'offline', value: 'offline' },
  { label: 'unknown', value: 'unknown' },
];

const DATA_SOURCE_LABEL: Record<string, string> = {
  firebase: 'Firebase Firestore (영속 저장)',
  memory: 'In-Memory (앱 종료 시 초기화)',
};

function fmtTime(iso: string | undefined): string {
  if (!iso) return '-';
  return `${formatClock(iso)} (${iso})`;
}

export default function DeveloperScreen() {
  const simulateEvent = useCareStore((s) => s.simulateEvent);
  const setStatus = useCareStore((s) => s.setStatus);
  const clearStatusOverride = useCareStore((s) => s.clearStatusOverride);
  const acknowledgeEmergency = useCareStore((s) => s.acknowledgeEmergency);
  const setDeviceHealthOverride = useCareStore((s) => s.setDeviceHealthOverride);
  const effectiveStatus = useCareStore((s) => s.status);
  const careStatus = useCareStore((s) => s.careStatus);
  const statusOverride = useCareStore((s) => s.statusOverride);
  const deviceHealth = useCareStore((s) => s.deviceHealth);
  const deviceHealthOverride = useCareStore((s) => s.deviceHealthOverride);
  const deviceDoc = useCareStore((s) => s.deviceDoc);
  const dataSource = useCareStore((s) => s.dataSource);
  const realtime = useCareStore((s) => s.realtime);
  const actionError = useCareStore((s) => s.actionError);
  const reload = useCareStore((s) => s.reload);
  const [lastLog, setLastLog] = useState<string>();
  const [detailError, setDetailError] = useState<string>();

  const overrideActive = Boolean(statusOverride);
  const effectiveDeviceHealth = deviceHealthOverride ?? deviceHealth.health;

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

      {/* ── 사람 축 read-out ───────────────────────────────────────────── */}
      <SectionHeader title="Care Status (사람 축)" />
      <Card>
        <Row
          k="effective status (화면 표시)"
          v={`${effectiveStatus}${overrideActive ? '  ← 임시 오버라이드' : ''}`}
        />
        <Row k="derived status (실제 판정)" v={careStatus.status} />
        <Row k="reason" v={careStatus.reason} />
        <Row
          k="minutesSinceActivity"
          v={
            careStatus.minutesSinceActivity == null
              ? '-'
              : String(careStatus.minutesSinceActivity)
          }
        />
        <Row k="systemHealth (사람 데이터)" v={careStatus.systemHealth} />
        <Row k="lastActivityAt" v={fmtTime(careStatus.lastActivityAt)} />
        <Row k="emergencyEventAt" v={fmtTime(careStatus.emergencyEventAt)} />
        <Row k="computedAt" v={careStatus.computedAt} />
        <Row
          k="inactivity threshold (분)"
          v={`${careStatusConfig.inactivityCheckMinutes}  (EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES)`}
          last
        />
      </Card>
      <Text style={styles.note}>
        위 임계값은 PoC/개발용 placeholder 이며 실제 안전 기준이 아닙니다.
      </Text>

      {/* ── 기기 축 read-out ───────────────────────────────────────────── */}
      <SectionHeader title="Device Health (기기 축)" />
      <Card>
        <Row
          k="effective health (화면 표시)"
          v={`${effectiveDeviceHealth}${
            deviceHealthOverride ? '  ← 임시 오버라이드' : ''
          }`}
        />
        <Row k="derived health (실제 판정)" v={deviceHealth.health} />
        <Row k="reason" v={deviceHealth.reason} />
        <Row k="lastEventAt" v={fmtTime(deviceHealth.lastEventAt)} />
        <Row k="lastHeartbeatAt" v={fmtTime(deviceHealth.lastHeartbeatAt)} />
        <Row k="lastSeenAt" v={fmtTime(deviceHealth.lastSeenAt)} />
        <Row
          k="minutesSinceSeen"
          v={
            deviceHealth.minutesSinceSeen == null
              ? '-'
              : String(deviceHealth.minutesSinceSeen)
          }
        />
        <Row k="computedAt" v={deviceHealth.computedAt} />
        <Row
          k="devices doc"
          v={deviceDoc ? `${deviceDoc.id}` : '없음 (또는 In-Memory)'}
          last
        />
      </Card>
      <Text style={styles.note}>
        Phase 4.1a: 아직 heartbeat 가 없어 실제 판정은 항상 unknown /
        no_heartbeat_capability 입니다. (lastEventAt 이 오래돼도 offline 으로 판정하지
        않습니다.) online/offline 실제 판정은 Phase 4.1b 에서 활성화됩니다.
      </Text>
      <View style={styles.statusRow}>
        {DEVICE_HEALTH_BUTTONS.map((btn) => (
          <PressableButton
            key={btn.value}
            label={btn.label}
            variant={
              deviceHealthOverride === btn.value ? 'solid' : 'outline'
            }
            style={styles.statusItem}
            onPress={() => setDeviceHealthOverride(btn.value)}
          />
        ))}
        <PressableButton
          label="자동으로"
          onPress={() => setDeviceHealthOverride(undefined)}
          style={styles.statusItem}
        />
      </View>
      <Text style={styles.note}>
        위 버튼은 실제 자동 판정을 임시로 덮어씁니다 (개발용 — TTL 없음, [자동으로] 로 해제).
      </Text>

      {/* ── 이벤트 발생 ────────────────────────────────────────────────── */}
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

      {/* ── 상태 임시 오버라이드 ──────────────────────────────────────── */}
      <SectionHeader title="상태 임시 오버라이드 (개발용)" />
      <Text style={styles.note}>
        아래 버튼은 자동 판정을{' '}
        {Math.round(careStatusConfig.overrideTtlMs / 60000)}분 동안 임시로
        덮어씁니다. 시간이 지나거나 아래 [자동 판정으로] 버튼을 누르면 자동
        판정으로 돌아갑니다.
      </Text>
      <View style={styles.statusRow}>
        {STATUS_BUTTONS.map((btn) => (
          <PressableButton
            key={btn.value}
            label={btn.label}
            variant={
              overrideActive && effectiveStatus === btn.value
                ? 'solid'
                : 'outline'
            }
            style={styles.statusItem}
            onPress={() => setStatus(btn.value)}
          />
        ))}
      </View>
      <View style={styles.statusRow}>
        <PressableButton
          label="자동 판정으로"
          onPress={() => clearStatusOverride()}
          style={styles.statusItem}
        />
        <PressableButton
          label="긴급 해제 (ack)"
          onPress={() => acknowledgeEmergency()}
          style={styles.statusItem}
        />
      </View>
      {overrideActive && statusOverride ? (
        <Text style={styles.note}>
          현재 오버라이드: {statusOverride.status} · 만료{' '}
          {formatClock(new Date(statusOverride.until).toISOString())}
        </Text>
      ) : null}

      <SectionHeader title="마지막 동작" />
      <Card>
        <Text style={styles.log}>
          {lastLog ?? '아직 발생시킨 이벤트가 없어요.'}
        </Text>
      </Card>
    </ScreenScrollView>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowKey}>{k}</Text>
      <Text style={styles.rowVal}>{v}</Text>
    </View>
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
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowKey: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 0,
  },
  rowVal: {
    ...typography.caption,
    color: colors.textPrimary,
    textAlign: 'right',
    flex: 1,
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
    marginTop: spacing.sm,
  },
  statusItem: {
    flex: 1,
  },
  log: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
});
