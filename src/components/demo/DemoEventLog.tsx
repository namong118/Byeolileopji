/**
 * 웹 데모 오른쪽 패널 — 맨 위 "현재 상태" 카드 + 실시간 자세 이벤트 로그 표.
 * EXPO_PUBLIC_DEMO_SNAPSHOT_URL 이 있으면 각 줄에 판단 근거 스냅샷 썸네일(브라우저 메모리에만 보관).
 * 행 높이는 썸네일 유무와 관계없이 고정해 표가 흔들리지 않게 한다.
 */
import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DEMO_SNAPSHOT_URL } from '../../config/demoMode';
import { colors, fontFamily, radius, spacing, typography } from '../../constants/theme';
import { useCareStore } from '../../stores/careStore';
import type { CareEvent } from '../../types/events';
import { POSTURE_LABEL, readPosture, type PostureReading } from '../../utils/posture';
import { readSnapshotSeq } from '../../utils/snapshot';
import { formatClock } from '../../utils/time';
import { CheckBadge } from './CheckBadge';
import { demoCard } from './demoStyles';
import { PostureIcon } from './PostureIcon';
import { usePostureAlert } from './usePostureAlert';
import { useSnapshots, type SnapshotState } from './useSnapshots';

const MAX_ROWS = 50;
const ROW_HEIGHT = 48;
const ROW_HEIGHT_WITH_THUMB = 64;
const THUMB_W = 64;
const THUMB_H = 48;

type Row = { e: CareEvent; r: PostureReading };

function caption({ e, r }: Row): string {
  const conf = r.confidence !== undefined ? ` · ${r.confidence.toFixed(2)}` : '';
  return `${e.location ?? '-'} · ${POSTURE_LABEL[r.posture]}${conf}`;
}

// ── 현재 상태 카드 ──────────────────────────────────────────────────────
function CurrentStateCard() {
  const alert = usePostureAlert();
  const latest = alert.latest;
  const pct = latest?.confidence !== undefined ? Math.round(latest.confidence * 100) : undefined;
  const tone = alert.needsCheck ? colors.status.CHECK : colors.status.NORMAL;

  return (
    <View style={styles.stateCard}>
      <Text style={styles.label}>현재 상태</Text>
      {latest ? (
        <>
          <View style={styles.stateMain}>
            <View style={[styles.stateIcon, { backgroundColor: tone.bg }]}>
              <PostureIcon posture={latest.posture} size={32} color={tone.fg} />
            </View>
            <View style={styles.stateText}>
              <Text style={styles.room}>{latest.location ?? '-'}</Text>
              <Text style={styles.posture}>{POSTURE_LABEL[latest.posture]}</Text>
            </View>
            {alert.needsCheck ? <CheckBadge /> : null}
          </View>
          <View style={styles.confRow}>
            <Text style={styles.confLabel}>confidence</Text>
            <View style={styles.barTrack}>
              <View
                style={[styles.barFill, { width: `${pct ?? 0}%`, backgroundColor: tone.fg }]}
              />
            </View>
            <Text style={styles.confValue}>{pct !== undefined ? `${pct}%` : '-'}</Text>
          </View>
          <Text style={styles.meta}>
            {alert.needsCheck
              ? `${latest.location ?? '-'}에서 ${Math.floor(alert.lyingElapsedMs / 1000)}초째 누워 있음`
              : `${formatClock(latest.occurredAt)} 확정`}
          </Text>
        </>
      ) : (
        <Text style={styles.meta}>아직 확정된 자세가 없어요.</Text>
      )}
    </View>
  );
}

// ── 스냅샷 썸네일 (고정 크기) ───────────────────────────────────────────
function Thumb({ row, state, onOpen }: { row: Row; state?: SnapshotState; onOpen: () => void }) {
  if (!state || state.status !== 'ok') {
    return (
      <View style={[styles.thumb, styles.thumbEmpty]}>
        <Text style={styles.thumbEmptyText}>
          {state?.status === 'loading' ? '받는 중' : '사진 없음'}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={`스냅샷 크게 보기: ${caption(row)}`}>
      <View style={styles.thumb}>
        <Image source={{ uri: state.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <Text style={styles.overlay} numberOfLines={1}>
          {POSTURE_LABEL[row.r.posture]}
        </Text>
      </View>
    </Pressable>
  );
}

export function DemoEventLog({ width, height }: { width: number; height: number }) {
  const events = useCareStore((s) => s.events);
  const snapshots = useSnapshots(events);
  const [opened, setOpened] = useState<{ row: Row; uri: string } | null>(null);

  const rows: Row[] = [];
  for (const e of events) {
    const r = readPosture(e);
    if (r) rows.push({ e, r });
  }
  rows.sort((a, b) => Date.parse(b.e.occurredAt) - Date.parse(a.e.occurredAt));

  const withThumbs = Boolean(DEMO_SNAPSHOT_URL);
  const rowHeight = withThumbs ? ROW_HEIGHT_WITH_THUMB : ROW_HEIGHT;

  return (
    <View style={[demoCard, styles.panel, { width, height }]}>
      <CurrentStateCard />

      <View style={styles.logHeader}>
        <Text style={styles.sectionTitle}>이벤트 로그</Text>
        <Text style={styles.meta}>
          {withThumbs ? '사진은 로컬 XIAO 에서 받아 이 브라우저에만 보관' : 'XIAO → Worker → Firestore'}
        </Text>
      </View>

      <View style={[styles.tr, styles.th]}>
        {withThumbs ? <Text style={[styles.headText, styles.colThumb]}>사진</Text> : null}
        <Text style={[styles.headText, styles.colTime]}>시각</Text>
        <Text style={[styles.headText, styles.colRoom]}>방</Text>
        <Text style={[styles.headText, styles.colPosture]}>자세</Text>
        <Text style={[styles.headText, styles.colConf]}>conf.</Text>
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="radio-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>XIAO 이벤트를 기다리는 중</Text>
          <Text style={styles.meta}>자세가 확정되면 여기에 바로 나타나요.</Text>
        </View>
      ) : (
        <ScrollView style={styles.list}>
          {rows.slice(0, MAX_ROWS).map((row) => {
            const { e, r } = row;
            const state = snapshots[e.id];
            const hasSeq = readSnapshotSeq(e) !== undefined;
            return (
              <View key={e.id} style={[styles.tr, { height: rowHeight }]}>
                {withThumbs ? (
                  <View style={styles.colThumb}>
                    {hasSeq ? (
                      <Thumb
                        row={row}
                        state={state}
                        onOpen={() => {
                          if (state?.status === 'ok') setOpened({ row, uri: state.uri });
                        }}
                      />
                    ) : (
                      <View style={[styles.thumb, styles.thumbEmpty]}>
                        <Text style={styles.thumbEmptyText}>사진 없음</Text>
                      </View>
                    )}
                  </View>
                ) : null}
                <Text style={[styles.td, styles.colTime]}>{formatClock(e.occurredAt)}</Text>
                <Text style={[styles.td, styles.colRoom]} numberOfLines={1}>
                  {e.location ?? '-'}
                </Text>
                <View style={[styles.colPosture, styles.postureCell]}>
                  <PostureIcon posture={r.posture} size={16} color={colors.green} />
                  <Text style={styles.td} numberOfLines={1}>
                    {POSTURE_LABEL[r.posture]}
                  </Text>
                </View>
                <Text style={[styles.td, styles.colConf]}>
                  {r.confidence !== undefined ? r.confidence.toFixed(2) : '-'}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}

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
  panel: { padding: spacing.xl, gap: spacing.md, overflow: 'hidden' },

  // 현재 상태
  stateCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  stateMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stateIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: { flex: 1 },
  room: { ...typography.hero, color: colors.textPrimary },
  posture: { ...typography.cardValue, color: colors.textPrimary },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confLabel: { ...typography.caption, color: colors.textSecondary, width: 76 },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 4 },
  confValue: { ...typography.caption, fontFamily: fontFamily.semiBold, color: colors.textPrimary, width: 40, textAlign: 'right' },
  meta: { ...typography.caption, color: colors.textSecondary },

  // 로그 표
  logHeader: { gap: 2, marginTop: spacing.xs },
  sectionTitle: { ...typography.sectionTitle, color: colors.textPrimary },
  list: { flex: 1 },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: { paddingBottom: spacing.sm },
  headText: { ...typography.caption, fontFamily: fontFamily.semiBold, color: colors.textSecondary },
  td: { ...typography.caption, color: colors.textPrimary },
  colThumb: { width: THUMB_W },
  colTime: { width: 72 },
  colRoom: { flex: 1 },
  colPosture: { flex: 1.3 },
  postureCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colConf: { width: 44, textAlign: 'right' },

  // 빈 상태
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyTitle: { ...typography.bodyStrong, color: colors.textPrimary },

  // 썸네일
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.textPrimary,
    justifyContent: 'flex-end',
  },
  thumbEmpty: {
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmptyText: { fontFamily: fontFamily.medium, fontSize: 10, color: colors.textSecondary },
  overlay: {
    fontFamily: fontFamily.semiBold,
    fontSize: 9,
    color: colors.surface,
    backgroundColor: 'rgba(23,50,77,0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  overlayLarge: { fontSize: 15, paddingHorizontal: 12, paddingVertical: 8 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,50,77,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    width: 640,
    height: 480,
    maxWidth: '90%',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.textPrimary,
    justifyContent: 'flex-end',
  },
});
