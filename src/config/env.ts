/**
 * 환경변수 접근 지점.
 *
 * Expo 는 `EXPO_PUBLIC_` 접두사가 붙은 변수만 클라이언트 번들에 주입한다.
 * 서버 secret(예: Firebase service account / admin private key)은 절대 여기서 읽지 않는다.
 */

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Firebase Web 앱 config. Firebase Console > 프로젝트 설정 > 내 앱(Web) 에서 확인. */
export const firebaseConfig = {
  apiKey: read('EXPO_PUBLIC_FIREBASE_API_KEY'),
  authDomain: read('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: read('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: read('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: read('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: read('EXPO_PUBLIC_FIREBASE_APP_ID'),
} as const;

export const env = {
  careRecipientIdOverride: read('EXPO_PUBLIC_CARE_RECIPIENT_ID'),
  deviceIdOverride: read('EXPO_PUBLIC_DEVICE_ID'),
  /** XIAO 자세 인식 웹 데모 보호대상 ID. 웹(Platform.OS==='web')에서만 쓰인다 — demoMode.ts */
  demoRecipientId: read('EXPO_PUBLIC_DEMO_RECIPIENT_ID'),
  /** 데모 "확인이 필요해요" 배지: 침대 밖 lying 지속 기준(초). 기본 30 */
  demoLyingAlertSeconds: read('EXPO_PUBLIC_DEMO_LYING_ALERT_SECONDS'),
  /** XIAO 판단 근거 스냅샷 로컬 주소 (예: http://192.168.0.20:81/snapshot). 웹 데모 전용 */
  demoSnapshotUrl: read('EXPO_PUBLIC_DEMO_SNAPSHOT_URL'),
} as const;

/**
 * Firestore 를 쓰기 위한 필수 config 값이 모두 있으면 true.
 * (apiKey / projectId / appId 는 Firestore 초기화에 반드시 필요하다)
 */
export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}
