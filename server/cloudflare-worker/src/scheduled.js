/**
 * Cloudflare Cron Trigger 오케스트레이션 — Phase 4.3 STEP B-4.
 *
 *   wrangler.toml [triggers] crons = ["*​/10 * * * *"]
 *        │  10분마다
 *        ▼
 *   index.js  scheduled(controller, env)
 *        │  runScheduledCareStatus(env, { now: controller.scheduledTime })
 *        ▼
 *   각 대상: computeCompareAndWriteCareStatusSnapshot()   ← careStatusWriter.js (B-3)
 *        │   READ source → normalize → compute → READ previous → transition detect → WRITE
 *        ▼
 *   { now, results: [{ careRecipientId, status, deviceHealth, isInitial, changed,
 *                      personTransition, deviceTransition }] }
 *
 * ── Cron 의 역할 ─────────────────────────────────────────────────────
 *  Cron 은 **판정 로직이 아니다.** "10분마다 기존 careStatus pipeline 을 실행" 하는
 *  트리거일 뿐이다. 상태 판정 semantics 는 STEP A 공유 코어 그대로.
 *  Cron cadence(10분) 와 상태 threshold(inactivity 180분 / device offline 25분) 는
 *  **별개 개념**이다 — Cron 이 10분이라고 offline threshold 를 10분으로 바꾸지 않는다.
 *
 * ── SOS / EMERGENCY ─────────────────────────────────────────────────
 *  Cron 은 일상적인 상태 재평가용이다. 향후 실제 SOS/EMERGENCY 알림은 이 10분 주기를
 *  기다리면 안 된다 (ingest → 즉시 EMERGENCY/FCM 경로는 Phase 4.4). 이 파일은 그 즉시
 *  경로를 막지 않는다 — ingest endpoint 에 새 side effect 를 넣지 않았다.
 *
 * ── threshold ───────────────────────────────────────────────────────
 *  서버 threshold 는 **Worker env 로 독립**한다. 앱 개발용 `EXPO_PUBLIC_*`
 *  (`EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2` 등) 를 **절대 참조하지 않는다.**
 *  기본값 = 앱 production default 와 동일 (inactivity 180분 / device offline 25분 /
 *  emergency lookback·TTL 12h). **초기 제품 운영값이며 실사용 데이터로 튜닝 필요** —
 *  의학적/안전 기준으로 확정된 값이 아니다.
 *
 * ── 실패 ────────────────────────────────────────────────────────────
 *  READ / compute / previous READ / WRITE 어디서든 실패하면 **throw** 한다.
 *  성공("completed")으로 삼키지 않는다. index.js scheduled() 가 이 throw 를
 *  다시 던져 Cloudflare 가 해당 invocation 을 실패로 기록하게 한다.
 *
 * ── FCM 알림 (Phase 4.4 STEP 1) ────────────────────────────────────
 *  전환(`changed && !isInitial`)이 감지되면, **스냅샷 WRITE 성공 후에** notifier.js
 *  (`notifyCareStatusTransition`)를 호출한다. notifier 는 **절대 throw 하지 않는다**
 *  → FCM/OAuth/토큰조회 실패가 이 Cron invocation 을 실패로 만들지 않는다.
 *  FCM 설정(secret + `FCM_NOTIFICATIONS_ENABLED=true`)이 없으면 조용히 skip 한다.
 *
 * ⚠️ 로그에 token / key / Authorization header 를 출력하지 않는다.
 */

import { computeCompareAndWriteCareStatusSnapshot } from './careStatusWriter.js';
import { notifyCareStatusTransition } from './notifier.js';

/**
 * 서버 careStatus threshold 기본값.
 * 앱 `src/config/careStatusConfig.ts` 의 **production default 와 동일**하게 맞춘다.
 * (앱 개발용 `EXPO_PUBLIC_INACTIVITY_CHECK_MINUTES=2` override 와는 무관 — 그건 Expo client 전용.)
 * ⚠️ 초기 제품 운영값. 실사용(수면·외출·센서 위치·생활 패턴) 데이터로 튜닝해야 한다.
 */
export const DEFAULT_SERVER_THRESHOLDS = Object.freeze({
  inactivityMinutes: 180,
  deviceOfflineMinutes: 25, // Phase 4.1b 값 유지. Cron cadence(10분)와 별개.
  emergencyLookbackHours: 12,
  emergencyTtlHours: 12,
});

/** number | 숫자 문자열 | 그 외 → 양수면 그 값, 아니면 fallback. */
function positiveNumberOr(value, fallback) {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Worker env → 서버 threshold. `EXPO_PUBLIC_*` 를 참조하지 않는다.
 * wrangler.toml `[vars]` 또는 `wrangler secret` 이 아닌 일반 var 로 주입 (비밀 아님).
 */
export function resolveServerThresholds(env = {}) {
  return {
    inactivityMinutes: positiveNumberOr(
      env.INACTIVITY_CHECK_MINUTES,
      DEFAULT_SERVER_THRESHOLDS.inactivityMinutes,
    ),
    deviceOfflineMinutes: positiveNumberOr(
      env.DEVICE_OFFLINE_MINUTES,
      DEFAULT_SERVER_THRESHOLDS.deviceOfflineMinutes,
    ),
    emergencyLookbackHours: positiveNumberOr(
      env.EMERGENCY_LOOKBACK_HOURS,
      DEFAULT_SERVER_THRESHOLDS.emergencyLookbackHours,
    ),
    emergencyTtlHours: positiveNumberOr(
      env.EMERGENCY_TTL_HOURS,
      DEFAULT_SERVER_THRESHOLDS.emergencyTtlHours,
    ),
  };
}

/**
 * scheduled 계산 대상 목록.
 *
 * 현재는 **단일 dev recipient** (Auth / guardian model 도입 전). 대상 id 는 Worker env
 * (`CARE_RECIPIENT_ID` / `DEVICE_ID`, wrangler.toml `[vars]`) 에서 온다 — 코드에
 * `dev-care-recipient` 를 하드코딩하지 않는다.
 *
 * multi-recipient 는 Phase 4.4(Firebase Auth + guardian) 이후 여기서 목록을 Firestore
 * 에서 읽어오도록 확장한다 — 지금 그 구조를 만들지 않는다.
 *
 * @throws env 에 대상 id 가 없으면.
 */
export function resolveScheduledTargets(env = {}) {
  const careRecipientId = env.CARE_RECIPIENT_ID;
  const deviceId = env.DEVICE_ID;
  if (!careRecipientId || !deviceId) {
    throw new Error(
      'runScheduledCareStatus: CARE_RECIPIENT_ID / DEVICE_ID env 가 필요하다 (wrangler.toml [vars]).',
    );
  }
  return [{ careRecipientId, deviceId }];
}

/**
 * Cron scheduled() 의 실제 오케스트레이션. **Cloudflare runtime 없이 Node 스모크에서
 * 테스트 가능**하도록 scheduled handler 와 분리했다.
 *
 * 각 대상에 B-3 pipeline(`computeCompareAndWriteCareStatusSnapshot`)을 순차 실행한다.
 * 어느 대상이든 실패하면 즉시 throw — 성공으로 삼키지 않는다.
 *
 * @param env  Worker env (FIREBASE_PROJECT_ID / CARE_RECIPIENT_ID / DEVICE_ID / threshold vars)
 * @param opts.now     Date. Cron tick 시각 (index.js 가 controller.scheduledTime 을 넣는다)
 * @param opts.logger  기본 console. 최소 진단 로그만.
 * @returns {Promise<{ now: string, results: Array }>}
 * @throws Firestore READ / compute / previous READ / WRITE 실패 시
 */
export async function runScheduledCareStatus(env, { now = new Date(), logger = console } = {}) {
  const thresholds = resolveServerThresholds(env);
  const targets = resolveScheduledTargets(env);

  const results = [];
  for (const { careRecipientId, deviceId } of targets) {
    const r = await computeCompareAndWriteCareStatusSnapshot(env, {
      careRecipientId,
      deviceId,
      thresholds,
      now,
    });

    const t = r.transition;
    const personStr = t.personTransition
      ? `${t.personTransition.from}->${t.personTransition.to}`
      : '-';
    const deviceStr = t.deviceTransition
      ? `${t.deviceTransition.from}->${t.deviceTransition.to}`
      : '-';
    // careRecipientId 는 불투명 문서 id (이름/전화 아님). status/deviceHealth 는 enum.
    logger.log(
      `[care-status] scheduled compute ok recipient=${careRecipientId} ` +
        `status=${r.snapshot.person.status} device=${r.snapshot.device.health} ` +
        `initial=${t.isInitial} changed=${t.changed} person=${personStr} device.transition=${deviceStr}`,
    );

    // ── FCM 알림 (Phase 4.4 STEP 1) ──────────────────────────────────
    //  스냅샷 WRITE 는 위에서 이미 성공했다 (실패면 throw 되어 여기 못 온다).
    //  전환일 때만, 그리고 notifier 는 절대 throw 하지 않는다 → Cron 안전.
    let notify = null;
    if (t.changed && !t.isInitial) {
      notify = await notifyCareStatusTransition(
        env,
        { careRecipientId, transition: t },
        { now, logger },
      );
      logger.log(
        `[care-status] notify recipient=${careRecipientId} decided=${notify.decided} ` +
          `sent=${notify.sent} failed=${notify.failed} skipped=${notify.skipped ?? '-'}`,
      );
    }

    results.push({
      careRecipientId,
      status: r.snapshot.person.status,
      deviceHealth: r.snapshot.device.health,
      isInitial: t.isInitial,
      changed: t.changed,
      personTransition: t.personTransition,
      deviceTransition: t.deviceTransition,
      notify,
    });
  }

  return { now: now.toISOString(), results };
}
