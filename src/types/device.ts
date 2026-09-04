/**
 * Firestore `devices/{deviceId}` 문서를 앱에서 다루는 최소 형태.
 *
 * 원격 문서(Timestamp 등)는 deviceRepository 에서 이 형태로 정규화한다.
 * (careRecipients/{id} 처럼 파생/캐시가 아니라 레지스트리 원본 데이터다.)
 */
export interface DeviceDoc {
  id: string;
  name?: string;
  type?: string;
  location?: string;
  enabled?: boolean;
  /** 마지막 이벤트가 서버에 도착한 시각 (ISO). Worker 가 ingest 성공 시 갱신 (Phase 4.1a). */
  lastEventAt?: string;
  /** ESP32 가 살아있음을 마지막으로 확인한 시각 (ISO). Phase 4.1b 에서 채워진다. */
  lastHeartbeatAt?: string;
}
