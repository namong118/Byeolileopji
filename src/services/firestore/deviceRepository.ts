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

export type DeviceListener = (device: DeviceDoc | undefined) => void;

export interface DeviceRepository {
  /** 구독 즉시 현재 스냅샷으로 1회, 이후 변경마다 호출. 문서 없으면 undefined. */
  subscribe(listener: DeviceListener): Unsubscribe;
}

const DEVICES_COLLECTION = 'devices';

export class FirestoreDeviceRepository implements DeviceRepository {
  private readonly db: Firestore;
  private readonly deviceId: string;

  constructor(db: Firestore, deviceId: string) {
    this.db = db;
    this.deviceId = deviceId;
  }

  subscribe(listener: DeviceListener): Unsubscribe {
    return onSnapshot(
      doc(this.db, DEVICES_COLLECTION, this.deviceId),
      (snap) => {
        if (!snap.exists()) {
          listener(undefined);
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
        });
      },
      (error) => {
        if (__DEV__) console.error('[별일없지] devices 구독 오류', error);
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
