/**
 * Firebase 초기화 (Expo managed workflow — Firebase JS SDK).
 *
 * - @react-native-firebase 가 아니라 `firebase` (JS SDK) 를 쓴다. Expo Go 에서 바로 동작.
 * - 인증은 아직 없다. Firestore 만 사용한다.
 * - config 가 없으면 null 을 반환하고, 호출부는 InMemory 로 폴백한다.
 *
 * React Native 에서는 Firestore 의 WebChannel 스트리밍이 불안정할 수 있어
 * `experimentalForceLongPolling` 으로 롱폴링을 강제한다. (Expo/RN 권장 패턴)
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';

import { firebaseConfig, isFirebaseConfigured } from '../config/env';

const APP_NAME = 'byeolileopji';

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;

function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null;
  if (appInstance) return appInstance;

  const existing = getApps().find((a) => a.name === APP_NAME);
  appInstance =
    existing ??
    initializeApp(
      {
        apiKey: firebaseConfig.apiKey,
        authDomain: firebaseConfig.authDomain,
        projectId: firebaseConfig.projectId,
        storageBucket: firebaseConfig.storageBucket,
        messagingSenderId: firebaseConfig.messagingSenderId,
        appId: firebaseConfig.appId,
      },
      APP_NAME,
    );
  return appInstance;
}

/** 설정돼 있으면 Firestore 인스턴스를, 아니면 null 을 반환한다. */
export function getFirestoreDb(): Firestore | null {
  if (dbInstance) return dbInstance;
  const app = getFirebaseApp();
  if (!app) return null;

  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
  });
  return dbInstance;
}
