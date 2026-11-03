/**
 * 새 자세 이벤트(snapshotSeq 있음)가 오면 로컬 XIAO /snapshot 을 받아 브라우저 메모리(blob URL)에만 둔다.
 * EXPO_PUBLIC_DEMO_SNAPSHOT_URL 이 없으면 아무것도 하지 않는다. 저장소(localStorage 등)에 쓰지 않는다.
 */
import { useEffect, useRef, useState } from 'react';

import { DEMO_SNAPSHOT_URL } from '../../config/demoMode';
import type { CareEvent } from '../../types/events';
import { isFreshSnapshotEvent, matchSnapshot, readSnapshotSeq } from '../../utils/snapshot';

export type SnapshotState = { status: 'loading' } | { status: 'ok'; uri: string } | { status: 'none' };

type Fetched = { status: 'ok'; uri: string } | { status: 'none' };

const FETCH_TIMEOUT_MS = 5000;
const MAX_KEPT = 20; // 메모리 상한 — 오래된 blob URL 은 해제

async function fetchSnapshot(url: string, eventSeq: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    if (matchSnapshot(eventSeq, res.headers.get('X-Snapshot-Seq')) === 'stale') return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function useSnapshots(events: readonly CareEvent[]): Record<string, SnapshotState> {
  const [fetched, setFetched] = useState<Record<string, Fetched>>({});
  const [sinceMs] = useState(() => Date.now()); // 화면을 연 시각 — 그 전 이벤트는 받지 않는다
  const requested = useRef(new Set<string>());
  const kept = useRef<string[]>([]);
  const latest = useRef(fetched);
  useEffect(() => {
    latest.current = fetched;
  }, [fetched]);

  useEffect(() => {
    const url = DEMO_SNAPSHOT_URL;
    if (!url) return;
    for (const e of events) {
      const seq = readSnapshotSeq(e);
      if (seq === undefined || requested.current.has(e.id)) continue;
      if (!isFreshSnapshotEvent(e, sinceMs)) continue;
      requested.current.add(e.id);
      void fetchSnapshot(url, seq).then((uri) => {
        setFetched((s) => {
          const next: Record<string, Fetched> = {
            ...s,
            [e.id]: uri ? { status: 'ok', uri } : { status: 'none' },
          };
          if (uri) {
            kept.current.push(e.id);
            while (kept.current.length > MAX_KEPT) {
              const old = kept.current.shift();
              const st = old ? next[old] : undefined;
              if (old && st?.status === 'ok') {
                URL.revokeObjectURL(st.uri);
                next[old] = { status: 'none' };
              }
            }
          }
          return next;
        });
      });
    }
  }, [events, sinceMs]);

  // 화면을 닫으면 blob URL 해제
  useEffect(
    () => () => {
      for (const st of Object.values(latest.current)) {
        if (st.status === 'ok') URL.revokeObjectURL(st.uri);
      }
    },
    [],
  );

  const out: Record<string, SnapshotState> = {};
  if (!DEMO_SNAPSHOT_URL) return out;
  for (const e of events) {
    if (readSnapshotSeq(e) === undefined) continue;
    const f = fetched[e.id];
    if (f) out[e.id] = f;
    else out[e.id] = isFreshSnapshotEvent(e, sinceMs) ? { status: 'loading' } : { status: 'none' };
  }
  return out;
}
