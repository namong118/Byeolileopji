/**
 * Firebase 초기화 (Expo managed workflow — Firebase JS SDK).
 *
 * - @react-native-firebase 가 아니라 `firebase` (JS SDK) 를 쓴다. Expo Go 에서 바로 동작.
 * - config 가 없으면 null 을 반환하고, 호출부는 InMemory 로 폴백한다.
 *
 * React Native 에서는 Firestore 의 WebChannel 스트리밍이 불안정할 수 있어
 * `experimentalForceLongPolling` 으로 롱폴링을 강제한다. (Expo/RN 권장 패턴)
 *
 * Phase 5 STEP 5.1 — Auth 는 `getReactNativePersistence(AsyncStorage)` 로 초기화한다.
 * (Firebase 공식 패턴: initializeAuth 를 persistence 없이/getAuth 로 쓰면 RN 에서
 *  메모리 지속성으로 조용히 폴백해 앱을 재시작하면 로그인이 풀린다.)
 *
 * ⚠️ `firebase/auth`(래퍼 패키지, v12.18.0) 의 package.json exports 맵에는
 *    "react-native" 조건이 없어(node/browser/default 뿐) `getReactNativePersistence`
 *    가 런타임에서 빠진다. 실제 구현 패키지인 `@firebase/auth` 는 "react-native" 조건
 *    (`dist/rn/index.js`)을 정상 제공하므로 여기서는 `@firebase/auth` 를 직접 쓴다
 *    (tsconfig `customConditions:["react-native"]` 가 Metro 런타임 해석에 반영된다).
 *    Auth 관련 심볼은 authStore.ts 에서도 동일하게 `@firebase/auth` 에서 가져온다.
 *
 *    다만 TypeScript 는 exports 맵의 "types" 조건을 always-first 로 골라, 플랫폼
 *    공통 타입만 롤업한 `dist/auth-public.d.ts` 를 본다 — 거기엔 RN 전용
 *    `getReactNativePersistence` 타입이 없다(firebase-js-sdk 저장소에 실제로 열려있는
 *    타입 선언 누락, 예: issue #9316, #7615 — 이 프로젝트 설정 문제가 아니다).
 *    아래 한 줄만 `@ts-expect-error` 로 타입 누락을 명시하고, 런타임 심볼은 실제로
 *    존재한다(위 rn/index.js 조건).
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import { initializeAuth, type Auth } from '@firebase/auth';
// @ts-expect-error — @firebase/auth 의 "types" 조건(auth-public.d.ts)에는 RN 전용
// getReactNativePersistence 가 없다. 런타임(rn/index.js)에는 실제로 존재한다.
import { getReactNativePersistence } from '@firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { firebaseConfig, isFirebaseConfigured } from '../config/env';

const APP_NAME = 'byeolileopji';

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

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

/** 설정돼 있으면 Auth 인스턴스를, 아니면 null 을 반환한다. */
export function getFirebaseAuth(): Auth | null {
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  if (!app) return null;

  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return authInstance;
}
