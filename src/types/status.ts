/**
 * 보호대상의 현재 안심 상태.
 *
 * Phase 1 에서는 판단 알고리즘 없이 개발자 화면에서 수동으로 변경한다.
 * Phase 4 에서 무활동 시간 기반 자동 판단으로 교체된다.
 */

export type CareStatus = 'NORMAL' | 'CHECK' | 'EMERGENCY';

export interface CareStatusView {
  status: CareStatus;
  emoji: string;
  headline: string;
}

export const CARE_STATUS_VIEW: Record<CareStatus, CareStatusView> = {
  NORMAL: { status: 'NORMAL', emoji: '🟢', headline: '오늘도 별일 없어요' },
  CHECK: { status: 'CHECK', emoji: '🟡', headline: '한번 확인해 주세요' },
  EMERGENCY: { status: 'EMERGENCY', emoji: '🔴', headline: '도움이 필요할 수 있어요' },
};
