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
