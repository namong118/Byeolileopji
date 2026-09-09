/**
 * careStatus 전환 → **푸시 알림 결정** (Phase 4.4 STEP 1).
 *
 * 순수 함수. firebase / fetch / Worker env / `Date.now()` import 없음.
 * Worker(esbuild) · Node 스모크 · 앱 모두 import 가능.
 *
 *   deriveCareStatusTransition()  (B-3, careStatusTransition.ts)
 *        │  { isInitial, personTransition, deviceTransition, changed }
 *        ▼
 *   deriveTransitionNotifications()  ← 이 파일
 *        │  0 또는 1개의 TransitionNotification
 *        ▼
 *   notifier.js (Worker)  → FCM HTTP v1
 *
 * ── 왜 "0 또는 1개" 인가 ─────────────────────────────────────────────
 *  10분 Cron 이 매번 돌기 때문에, 같은 전환에서 사람 축 알림 + 기기 축 알림을
 *  각각 보내면 보호자가 잠금화면에서 알림 2개를 받는다. MVP 는 **전환당 알림 1개**로
 *  고정한다. 두 축이 동시에 전환되면 우선순위 규칙으로 하나만 고르거나(또는 결합 문구),
 *  "우연히 2개가 발송되는 구조"를 코드 구조상 불가능하게 만든다.
 *
 * ── source of truth ────────────────────────────────────────────────
 *  전환 감지는 B-3 `deriveCareStatusTransition` 이 유일한 기준이다. 이 파일은 그
 *  결과만 소비한다 — 전환을 새로 계산하지 않고, 시간 기반 중복 억제도 하지 않는다.
 *  (중복 억제 = "전환일 때만 발송" 으로 이미 충족. 같은 상태 유지 → transition 없음
 *   → 알림 없음.)
 *
 * ── 문구 정책 ──────────────────────────────────────────────────────
 *  의학적 진단 문구 금지. "쓰러졌습니다 / 낙상 / 위험합니다 / 생명이 위험합니다" 처럼
 *  현재 센서 데이터로 확정할 수 없는 표현을 쓰지 않는다. 확인을 **권유**하는 톤만 쓴다.
 *
 * ⚠️ 이 파일은 알림을 **결정만** 한다. 실제 전송 / 토큰 조회 / FCM 은 notifier.js.
 */

import type { CareStatusTransitionResult } from './careStatusTransition';

/** 알림 종류 — 분석/테스트 식별용. UI enum 이 아니다. */
export type TransitionNotificationKind =
  | 'person_check' //            NORMAL/EMERGENCY → CHECK   (안부 확인 권유)
  | 'person_recovery' //         CHECK/EMERGENCY → NORMAL   (활동 재확인)
  | 'person_emergency' //        * → EMERGENCY              (최우선)
  | 'device_offline' //          online → offline          (센서 연결 확인)
  | 'device_recovery' //         offline → online          (센서 재연결)
  | 'person_check_device_offline'; // 사람 CHECK 진입 + 기기 offline 진입 동시

/** FCM `data` 페이로드. FCM v1 data 는 string map 이므로 모든 값이 문자열이다. */
export interface TransitionNotificationData {
  /** 앱이 딥링크 분기에 쓰는 고정 태그. */
  type: 'CARE_STATUS_TRANSITION';
  kind: TransitionNotificationKind;
  /** 불투명 문서 id (이름/전화 아님). */
  careRecipientId: string;
  personFrom?: string;
  personTo?: string;
  deviceFrom?: string;
  deviceTo?: string;
}

export interface TransitionNotification {
  kind: TransitionNotificationKind;
  /** 'high' → 즉시성 필요(확인 권유). 'normal' → 복구 알림. FCM android priority 로 매핑. */
  priority: 'high' | 'normal';
  title: string;
  body: string;
  data: TransitionNotificationData;
}

export interface TransitionNotificationContext {
  careRecipientId: string;
}

// ── 문구 (task Phase 4.4 STEP 1 §4) ──────────────────────────────────
// 확정/진단 표현 금지. 확인 권유 톤만.

const COPY: Record<
  Exclude<TransitionNotificationKind, never>,
  { title: string; body: string; priority: 'high' | 'normal' }
> = {
  person_check: {
    title: '최근 활동이 확인되지 않았어요',
    body: '평소보다 활동 신호가 오래 확인되지 않았어요. 안부를 확인해 보세요.',
    priority: 'high',
  },
  person_recovery: {
    title: '활동이 다시 확인됐어요',
    body: '새로운 생활 활동 신호가 확인됐어요.',
    priority: 'normal',
  },
  person_emergency: {
    title: '긴급 확인이 필요해요',
    body: '긴급 신호가 확인됐어요. 바로 상태를 확인해 주세요.',
    priority: 'high',
  },
  device_offline: {
    title: '생활 센서를 확인해 주세요',
    body: '센서의 연결 신호가 일정 시간 확인되지 않고 있어요.',
    priority: 'high',
  },
  device_recovery: {
    title: '생활 센서가 다시 연결됐어요',
    body: '센서의 연결 신호가 다시 확인됐어요.',
    priority: 'normal',
  },
  person_check_device_offline: {
    title: '안부와 센서 상태를 확인해 주세요',
    body: '최근 활동과 센서 연결 신호가 함께 확인되지 않고 있어요.',
    priority: 'high',
  },
};

/** 단일 축 신호 (결합 kind `person_check_device_offline` 은 별도 처리). */
type SingleAxisSignal =
  | 'person_emergency'
  | 'person_check'
  | 'device_offline'
  | 'person_recovery'
  | 'device_recovery';

/**
 * 두 축 전환 신호에 우선순위를 매긴다. 높을수록 먼저.
 * emergency > person CHECK 진입 > device offline 진입 > person 복구 > device 복구.
 */
const SIGNAL_PRIORITY: Record<SingleAxisSignal, number> = {
  person_emergency: 100,
  person_check: 60,
  device_offline: 50,
  person_recovery: 20,
  device_recovery: 10,
};

/**
 * 전환 결과 → 발송할 알림 목록 (0개 또는 1개).
 *
 * - `isInitial` (첫 스냅샷) → `[]`  — baseline seed 는 알림 아님 (B-3 정책 그대로).
 *   최초 상태가 CHECK / EMERGENCY / offline 이어도 발송하지 않는다.
 * - `changed === false` → `[]`  — reason-only 변화 포함 (전환 identity 는 status/deviceHealth 만).
 * - 사람 축이 `EMERGENCY` 로 진입 → **emergency 알림 하나만** (기기 축 전환은 흡수).
 * - 사람 `CHECK` 진입 + 기기 `offline` 진입 동시 → **결합 알림 하나**.
 * - 그 외 → 우선순위가 가장 높은 신호 하나.
 *
 * @param transition  B-3 `deriveCareStatusTransition` 결과
 * @param ctx.careRecipientId  대상자 id (data 페이로드용)
 */
export function deriveTransitionNotifications(
  transition: CareStatusTransitionResult,
  ctx: TransitionNotificationContext,
): TransitionNotification[] {
  if (!ctx || typeof ctx.careRecipientId !== 'string' || ctx.careRecipientId === '') {
    throw new Error('deriveTransitionNotifications: ctx.careRecipientId required');
  }
  if (transition.isInitial || !transition.changed) return [];

  const p = transition.personTransition;
  const d = transition.deviceTransition;
  if (!p && !d) return []; // changed 가 true 인데 둘 다 null 이면 방어적으로 무시

  // 공통 data 페이로드 조각 (from/to 는 해당 축이 전환됐을 때만).
  const axisData: Partial<TransitionNotificationData> = {};
  if (p) {
    axisData.personFrom = p.from;
    axisData.personTo = p.to;
  }
  if (d) {
    axisData.deviceFrom = d.from;
    axisData.deviceTo = d.to;
  }

  const make = (kind: TransitionNotificationKind): TransitionNotification => ({
    kind,
    priority: COPY[kind].priority,
    title: COPY[kind].title,
    body: COPY[kind].body,
    data: {
      type: 'CARE_STATUS_TRANSITION',
      kind,
      careRecipientId: ctx.careRecipientId,
      ...axisData,
    },
  });

  // 1) EMERGENCY 최우선 — 사람이 EMERGENCY 로 진입하면 그 하나만.
  if (p && p.to === 'EMERGENCY') return [make('person_emergency')];

  // 2) 사람 CHECK 진입 + 기기 offline 진입 동시 → 결합 알림.
  if (p && p.to === 'CHECK' && d && d.to === 'offline') {
    return [make('person_check_device_offline')];
  }

  // 3) 각 축의 신호를 후보로 만들고 우선순위가 높은 하나만 고른다.
  const candidates: SingleAxisSignal[] = [];
  if (p) {
    if (p.to === 'CHECK') candidates.push('person_check');
    else if (p.to === 'NORMAL') candidates.push('person_recovery');
    // p.to === 'EMERGENCY' 는 위에서 처리됨
  }
  if (d) {
    if (d.to === 'offline') candidates.push('device_offline');
    else if (d.to === 'online') candidates.push('device_recovery');
    // d.to === 'unknown' 은 알림 대상 아님 (장애가 아니라 데이터 부재)
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => SIGNAL_PRIORITY[b] - SIGNAL_PRIORITY[a]);
  return [make(candidates[0])];
}
