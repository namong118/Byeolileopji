/**
 * 웹 데모 오른쪽 패널 — 실시간 자세 이벤트 로그 (시각, 방, 자세, confidence).
 * EXPO_PUBLIC_DEMO_SNAPSHOT_URL 이 있으면 각 줄에 판단 근거 스냅샷 썸네일(브라우저 메모리에만 보관).
 */
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DEMO_SNAPSHOT_URL } from '../../config/demoMode';
import { colors, fontFamily, radius, spacing, typography } from '../../constants/theme';
import { useCareStore } from '../../stores/careStore';
import type { CareEvent } from '../../types/events';
import { POSTURE_LABEL, readPosture, type PostureReading } from '../../utils/posture';
import { readSnapshotSeq } from '../../utils/snapshot';
import { formatClock } from '../../utils/time';
import { CheckBadge } from './CheckBadge';
import { usePostureAlert } from './usePostureAlert';
import { useSnapshots, type SnapshotState } from './useSnapshots';

const MAX_ROWS = 50;

type Row = { e: CareEvent; r: PostureReading };

function caption({ e, r }: Row): string {
  const conf = r.confidence !== undefined ? ` · ${r.confidence.toFixed(2)}` : '';
  return `${e.location ?? '-'} · ${POSTURE_LABEL[r.posture]}${conf}`;
}

function Thumb({ row, state, onOpen }: { row: Row; state?: SnapshotState; onOpen: () => void }) {
  if (!state || state.status === 'none') {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Text style={styles.thumbEmptyText}>사진 없음</Text>
      </View>
    );
  }
  if (state.status === 'loading') {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Text style={styles.thumbEmptyText}>받는 중…</Text>
      </View>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel="스냅샷 크게 보기">
      <View style={styles.thumb}>
        <Image source={{ uri: state.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <Text style={styles.overlay} numberOfLines={1}>
          {caption(row)}
        </Text>
      </View>
    </Pressable>
  );
}

export function DemoEventLog() {
  const events = useCareStore((s) => s.events);
  const alert = usePostureAlert();
  const snapshots = useSnapshots(events);
  const [opened, setOpened] = useState<{ row: Row; uri: string } | null>(null);

  const rows: Row[] = [];
  for (const e of events) {
    const r = readPosture(e);
    if (r) rows.push({ e, r });
  }
  rows.sort((a, b) => Date.parse(b.e.occurredAt) - Date.parse(a.e.occurredAt));

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>실시간 이벤트 로그</Text>
      <Text style={styles.sub}>XIAO ESP32-S3 Sense → Worker → Firestore</Text>
      {DEMO_SNAPSHOT_URL ? (
        <Text style={styles.sub}>판단 근거 사진은 로컬 XIAO 에서 받아 이 브라우저에만 보관해요.</Text>
      ) : null}
      {alert.needsCheck ? (
        <View style={styles.badgeWrap}>
          <CheckBadge />
          <Text style={styles.sub}>
            {`${alert.latest?.location ?? '-'}에서 ${Math.floor(alert.lyingElapsedMs / 1000)}초째 누워 있음`}
          </Text>
        </View>
      ) : null}
      <View style={[styles.row, styles.head]}>
        <Text style={[styles.cell, styles.time, styles.headText]}>시각</Text>
        <Text style={[styles.cell, styles.headText]}>방</Text>
        <Text style={[styles.cell, styles.headText]}>자세</Text>
        <Text style={[styles.cell, styles.conf, styles.headText]}>confidence</Text>
      </View>
      <ScrollView style={styles.list}>
        {rows.length === 0 ? <Text style={styles.empty}>아직 자세 이벤트가 없어요.</Text> : null}
        {rows.slice(0, MAX_ROWS).map((row) => {
          const { e, r } = row;
          const state = snapshots[e.id];
          const showThumb = Boolean(DEMO_SNAPSHOT_URL) && readSnapshotSeq(e) !== undefined;
          return (
            <View key={e.id} style={styles.entry}>
              <View style={styles.rowInner}>
                <Text style={[styles.cell, styles.time]}>{formatClock(e.occurredAt)}</Text>
                <Text style={styles.cell}>{e.location ?? '-'}</Text>
                <Text style={styles.cell}>{POSTURE_LABEL[r.posture]}</Text>
                <Text style={[styles.cell, styles.conf]}>
                  {r.confidence !== undefined ? r.confidence.toFixed(2) : '-'}
                </Text>
              </View>
              {showThumb ? (
                <Thumb
                  row={row}
                  state={state}
                  onOpen={() => {
                    if (state?.status === 'ok') setOpened({ row, uri: state.uri });
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={opened !== null} transparent animationType="fade" onRequestClose={() => setOpened(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpened(null)} accessibilityLabel="닫기">
          {opened ? (
            <View style={styles.large}>
              <Image source={{ uri: opened.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              <Text style={[styles.overlay, styles.overlayLarge]}>
                {`${formatClock(opened.row.e.occurredAt)} · ${caption(opened.row)}`}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 380,
    height: 844,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  sub: { ...typography.caption, color: colors.textSecondary },
  badgeWrap: { gap: spacing.xs },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  entry: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  rowInner: { flexDirection: 'row' },
  head: { borderBottomColor: colors.textSecondary },
  headText: { fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  cell: { flex: 1, ...typography.caption, color: colors.textPrimary },
  time: { flex: 1.2 },
  conf: { textAlign: 'right' },
  empty: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.md },
  thumb: {
    width: 160,
    height: 120,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: '#1B1F24',
    justifyContent: 'flex-end',
  },
  thumbEmpty: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
  },
  thumbEmptyText: { ...typography.caption, color: colors.textSecondary },
  overlay: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  overlayLarge: { fontSize: 15, paddingHorizontal: 10, paddingVertical: 6 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    width: 640,
    height: 480,
    maxWidth: '90%',
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: '#000000',
    justifyContent: 'flex-end',
  },
});
