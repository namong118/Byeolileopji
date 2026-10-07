/**
 * Firestore `devices/{deviceId}` 문서 구독 (읽기 전용).
 *
 *   careStore → eventService.deviceRepo → FirestoreDeviceRepository → Firestore
 *
 * 사람 축(events)과 완전히 별개의 작은 doc 하나만 구독한다.
 * InMemory 모드에는 device repo 가 없다 → 기기 축은 항상 'unknown'.
 */

import { doc, onSnapshot, type Firestore } from 'firebase/firestore';

import type { DeviceDoc } from '../../types/device';
import type { Unsubscribe } from '../eventRepository';
import { toIsoString } from '../../mappers/firestoreEventMapper';

/** info.fromCache = 서버 확인 없이 캐시에서 나온 스냅샷 (네트워크 끊김 등 — syncState.ts) */
export type DeviceListener = (
  device: DeviceDoc | undefined,
  info: { fromCache: boolean },
) => void;

export interface DeviceRepository {
  /**
   * 구독 즉시 현재 스냅샷으로 1회, 이후 변경마다 호출. 문서 없으면 undefined.
   * 캐시 ↔ 서버 전환(메타데이터 변경)도 호출된다. onError 는 구독이 종료됐을 때 1회.
   */
  subscribe(listener: DeviceListener, onError?: (error: unknown) => void): Unsubscribe;
}

const DEVICES_COLLECTION = 'devices';

export class FirestoreDeviceRepository implements DeviceRepository {
  private readonly db: Firestore;
  private readonly deviceId: string;

  constructor(db: Firestore, deviceId: string) {
    this.db = db;
    this.deviceId = deviceId;
  }

  subscribe(listener: DeviceListener, onError?: (error: unknown) => void): Unsubscribe {
    return onSnapshot(
      doc(this.db, DEVICES_COLLECTION, this.deviceId),
      // 네트워크 끊김은 error 가 아니라 fromCache 메타데이터 변경으로만 온다 (syncState.ts).
      { includeMetadataChanges: true },
      (snap) => {
        const info = { fromCache: snap.metadata.fromCache };
        if (!snap.exists()) {
          listener(undefined, info);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        listener({
          id: snap.id,
          name: str(data.name),
          type: str(data.type),
          location: str(data.location),
          enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
          lastEventAt: ts(data.lastEventAt),
          lastHeartbeatAt: ts(data.lastHeartbeatAt),
        }, info);
      },
      (error) => {
        if (__DEV__) console.error('[별일없지] devices 구독 오류', error);
        // 조용히 마지막 기기 상태("연결됨")로 멈추지 않게 호출자에게 알린다.
        onError?.(error);
      },
    );
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Firestore Timestamp | Date | ISO | {seconds} → ISO. 값이 없으면 undefined. */
function ts(v: unknown): string | undefined {
  if (v == null) return undefined;
  return toIsoString(v);
}
