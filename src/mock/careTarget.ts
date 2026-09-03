/**
 * 개발용 보호대상 정보.
 *
 * id 는 Firestore `careRecipients/{id}` 문서 ID 와 동일하게 쓴다(`dev-care-recipient`).
 * Phase 4 에서 Firebase Auth 프로필로 교체된다.
 */

import { DEV_CARE_RECIPIENT_ID } from '../config/careContext';

export interface CareTarget {
  id: string;
  name: string;
  relation: string;
}

export const mockCareTarget: CareTarget = {
  id: DEV_CARE_RECIPIENT_ID,
  name: '김영희',
  relation: '어머니',
};
