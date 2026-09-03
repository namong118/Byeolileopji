/**
 * 개발용 보호대상 정보.
 *
 * id 는 `supabase/migrations/*_seed_dev_data.sql` 의 care_recipients seed 와 동일한
 * 고정 UUID 를 사용한다. Phase 4 에서 Supabase Auth 프로필로 교체된다.
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
