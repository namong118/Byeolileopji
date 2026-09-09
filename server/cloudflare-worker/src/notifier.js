/**
 * careStatus 전환 → 보호자 푸시 알림 오케스트레이션 — Phase 4.4 STEP 1.
 *
 *   transition (B-3)  ── changed && !isInitial ──▶  notifyCareStatusTransition()
 *        │
 *        ├─ deriveTransitionNotifications()   순수 정책 (transitionNotification.ts)
 *        ├─ resolveFcmConfig()                kill-switch + secret 존재 확인
 *        ├─ queryGuardianPushTokens()         Firestore REST
 *        ├─ createGoogleAccessToken()         service-account OAuth2
 *        ├─ sendFcmMessage() × 토큰            FCM HTTP v1
 *        └─ disablePushToken()                invalid token 정리 (best-effort)
 *
 * ── 절대 규칙: careStatus WRITE 성공 후에만, 그리고 절대 throw 하지 않는다 ──
 *  이 함수는 `computeCompareAndWriteCareStatusSnapshot()` 이 스냅샷 WRITE 를 **성공**
 *  시킨 뒤에만 호출된다 (scheduled.js). FCM/OAuth/토큰조회 어디서 실패해도:
 *    - careStatus 문서를 되돌리지 않는다 (애초에 손대지 않는다)
 *    - transition 결과를 무효화하지 않는다
 *    - Firestore raw 데이터를 수정하지 않는다 (invalid token 비활성화 제외)
 *    - **throw 하지 않는다** → Cron invocation 을 실패로 만들지 않는다
 *  실패는 `[notify] …` 로그로만 남긴다. secret / token 값은 로그에 넣지 않는다.
 *
 * ── STEP 1 범위의 한계 (문서화된 알려진 갭) ────────────────────────
 *  · delivery queue / 재시도 없음. 한 Cron tick 에서 전송 실패한 알림은 **유실**된다
 *    (careStatus 문서는 이미 갱신됐으므로 다음 tick 에서 같은 전환이 재발생하지 않는다).
 *    → 재시도 큐는 다음 STEP TODO.
 *  · Cron 을 통째로 throw 시켜도 알림은 되살아나지 않는다 (위와 같은 이유) — 그래서
 *    notify 실패로 Cron 을 실패 처리하지 않는다.
 */

import {
  deriveTransitionNotifications,
} from '../../../src/services/transitionNotification.ts';
import {
  resolveFcmConfig,
  createGoogleAccessToken,
  sendFcmMessage,
  buildFcmMessage,
} from './fcmClient.js';
import { queryGuardianPushTokens, disablePushToken } from './pushTokenStore.js';

/** 에러 메시지를 로그에 넣기 전 마지막 방어선 — 길이 제한 + 개행 제거. */
function scrub(err) {
  const msg = err && err.message ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * @param env  Worker env (FIREBASE_PROJECT_ID / FCM_* / FIREBASE_API_KEY)
 * @param arg.careRecipientId  대상자 id
 * @param arg.transition       B-3 deriveCareStatusTransition 결과
 * @param opts.now             Date (JWT iat/exp)
 * @param opts.logger          기본 console
 * @param opts.fetchImpl       기본 globalThis.fetch (테스트 mock)
 * @returns {Promise<{ careRecipientId:string, decided:number, tokensTried:number,
 *                     sent:number, failed:number, invalidCleaned:number, skipped:string|null }>}
 *          — 항상 resolve. 절대 reject 하지 않는다.
 */
export async function notifyCareStatusTransition(
  env,
  { careRecipientId, transition },
  { now = new Date(), logger = console, fetchImpl = fetch } = {},
) {
  const result = {
    careRecipientId,
    decided: 0,
    tokensTried: 0,
    sent: 0,
    failed: 0,
    invalidCleaned: 0,
    skipped: null,
  };

  try {
    // 1) 순수 정책 — 발송할 알림 결정 (0 또는 1개).
    const notifications = deriveTransitionNotifications(transition, { careRecipientId });
    result.decided = notifications.length;
    if (notifications.length === 0) {
      result.skipped = 'no_policy_match';
      return result;
    }

    // 2) FCM 설정 (kill-switch + secret). 없으면 조용히 skip.
    const fcm = resolveFcmConfig(env);
    if (!fcm.configured) {
      logger.log(
        `[notify] skipped fcm=${fcm.reason} recipient=${careRecipientId} ` +
          `kinds=${notifications.map((n) => n.kind).join(',')}`,
      );
      result.skipped = `fcm_${fcm.reason}`;
      return result;
    }

    // 3) 보호자 토큰 조회.
    const tokens = await queryGuardianPushTokens(env, careRecipientId);
    if (tokens.length === 0) {
      logger.log(`[notify] no active push tokens recipient=${careRecipientId}`);
      result.skipped = 'no_tokens';
      return result;
    }

    // 4) OAuth2 access token. 실패 → skip (throw 하지 않음).
    let accessToken;
    try {
      ({ accessToken } = await createGoogleAccessToken(fcm, { now, fetchImpl }));
    } catch (err) {
      logger.error(`[notify] send failed: oauth token request (${scrub(err)})`);
      result.skipped = 'oauth_failed';
      return result;
    }

    // 5) 알림 × 토큰 전송.
    for (const notification of notifications) {
      for (const t of tokens) {
        result.tokensTried += 1;
        const message = buildFcmMessage(notification, t.token);
        let sendResult;
        try {
          sendResult = await sendFcmMessage(accessToken, fcm.projectId, message, { fetchImpl });
        } catch (err) {
          result.failed += 1;
          logger.error(`[notify] send failed: transport (${scrub(err)})`);
          continue;
        }

        if (sendResult.ok) {
          result.sent += 1;
          // messageId 도 굳이 로깅하지 않는다 (필요 시 Observability 로 충분).
          continue;
        }

        result.failed += 1;
        // 토큰 값은 로그에 넣지 않는다 — 문서 id + status + code 만.
        logger.error(
          `[notify] send rejected token=${t.id} status=${sendResult.status} ` +
            `code=${sendResult.errorCode ?? '-'}`,
        );

        if (sendResult.invalidToken) {
          try {
            await disablePushToken(env, t.id);
            result.invalidCleaned += 1;
          } catch (err) {
            logger.error(`[notify] token cleanup failed token=${t.id} (${scrub(err)})`);
          }
        }
      }
    }

    return result;
  } catch (err) {
    // 예상 못한 실패 — careStatus write 는 이미 성공했다. 삼킨다.
    logger.error(
      `[notify] unexpected failure (careStatus write unaffected) recipient=${careRecipientId}: ${scrub(err)}`,
    );
    result.skipped = 'error';
    return result;
  }
}
