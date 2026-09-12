/**
 * 보호자 기기 FCM 토큰 등록 — Phase 4.4 STEP 1 (앱 쪽).
 *
 *   expo-notifications  getDevicePushTokenAsync()   ← **native FCM registration token**
 *        │  (Expo Push Token 이 아니다 — 서버가 FCM HTTP v1 을 직접 호출하므로)
 *        ▼
 *   pushTokens/{tokenId}  Firestore 문서  (Worker notifier.js 가 조회)
 *
 * ── Expo Push vs native FCM ────────────────────────────────────────
 *  이 프로젝트는 Cloudflare Worker 가 **FCM HTTP v1 (`messages:send`)** 을 직접 호출한다
 *  (fcmClient.js). 따라서 Expo Push Service(Expo Push Token)가 아니라 **native FCM
 *  device token** 이 필요하다 → `Notifications.getDevicePushTokenAsync()` (`type: 'android'`).
 *
 * ── 동작 조건 (실기기 + 설정 필요) ────────────────────────────────
 *  · Expo Go 에서는 동작하지 않는다 (SDK 53+ 원격 푸시 제거). **development build 필요.**
 *  · Android: `google-services.json` (Firebase Console) + `app.json` android.googleServicesFile.
 *  · Firebase 프로젝트에 Android 앱 등록 (패키지명) + Cloud Messaging API (v1) 사용.
 *  위 조건이 안 갖춰지면 `getDevicePushTokenAsync()` 가 throw 한다 → 여기서 잡아서
 *  조용히 무시한다 (앱 실행을 막지 않는다). Firestore 미설정도 마찬가지.
 *
 * ── 이 파일이 하지 않는 것 ────────────────────────────────────────
 *  알림 수신 핸들러 / 딥링크 라우팅 — 다음 STEP.
 *  지금은 "토큰을 pushTokens 에 올려두는 것" 까지만.
 *
 * Phase 5 STEP 5.2 — guardianUid/careRecipientId 는 더 이상 기본값이 없다. 호출부
 * (app/_layout.tsx) 가 로그인 UID + guardianLinks 로 해석된 careRecipientId 를
 * 반드시 전달해야 한다 (둘 다 확정되기 전까지는 호출하지 않는다).
 */

import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { getFirestoreDb } from '../lib/firebase';
import { buildPushTokenDoc, pushTokenDocId } from './pushTokenDoc';

export { buildPushTokenDoc, pushTokenDocId } from './pushTokenDoc';
export type { PushPlatform, PushTokenDocInput } from './pushTokenDoc';

export const PUSH_TOKENS_COLLECTION = 'pushTokens';
/** Android 알림 채널 id — Worker buildFcmMessage 의 `android.notification.channel_id` 와 일치. */
export const CARE_STATUS_ANDROID_CHANNEL = 'care-status';

/**
 * 실기기에서 native FCM 토큰을 얻어 Firestore `pushTokens/{id}` 에 upsert 한다.
 *
 * 실패(빌드/설정 미비, 권한 거부, Firestore 미설정)는 **throw 하지 않고** 이유 문자열을
 * 반환한다 — 앱 부팅 흐름에서 fire-and-forget 으로 호출하기 위함.
 *
 * expo-notifications / expo-device 는 **동적 import** 한다 → Node 스모크(순수 함수만
 * import)와 웹 번들에서 native 모듈을 끌어오지 않는다.
 *
 * @param params.guardianUid       로그인한 Firebase Auth UID (토큰 소유자)
 * @param params.careRecipientId   guardianLinks 로 해석된 대상자 id
 * @returns {Promise<{ ok: true, tokenId: string } | { ok: false, reason: string }>}
 */
export async function registerForCareStatusPush(params: {
  guardianUid: string;
  careRecipientId: string;
}): Promise<{ ok: true; tokenId: string } | { ok: false; reason: string }> {
  const { guardianUid, careRecipientId } = params;

  let Notifications: typeof import('expo-notifications');
  let Device: typeof import('expo-device');
  try {
    Notifications = await import('expo-notifications');
    Device = await import('expo-device');
  } catch {
    return { ok: false, reason: 'expo-notifications unavailable' };
  }

  if (!Device.isDevice) return { ok: false, reason: 'not a physical device' };

  try {
    // Android 13+ 는 채널이 있어야 알림이 표시된다.
    await Notifications.setNotificationChannelAsync(CARE_STATUS_ANDROID_CHANNEL, {
      name: '안심 상태 알림',
      importance: Notifications.AndroidImportance.HIGH,
    });

    const perm = await Notifications.getPermissionsAsync();
    let granted = perm.granted;
    if (!granted && perm.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return { ok: false, reason: 'permission not granted' };

    // native FCM registration token (Expo Push Token 아님).
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const built = buildPushTokenDoc({
      token: devicePushToken.data,
      platform: devicePushToken.type,
      guardianUid,
      careRecipientId,
    });

    const db = getFirestoreDb();
    if (!db) return { ok: false, reason: 'firestore not configured' };

    const tokenId = pushTokenDocId(built.platform, built.token);
    await setDoc(
      doc(db, PUSH_TOKENS_COLLECTION, tokenId),
      {
        token: built.token,
        platform: built.platform,
        guardianUid: built.guardianUid,
        careRecipientId: built.careRecipientId,
        enabled: true,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(), // merge:true 라 최초 1회만 실질 반영
      },
      { merge: true },
    );

    return { ok: true, tokenId };
  } catch (err) {
    if (__DEV__) console.warn('[별일없지] push 토큰 등록 실패(무시)', err);
    return { ok: false, reason: 'registration threw' };
  }
}
