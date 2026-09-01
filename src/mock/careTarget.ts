/** 목업 보호대상 정보. Phase 2 에서 Supabase 프로필로 교체된다. */

export interface CareTarget {
  id: string;
  name: string;
  relation: string;
}

export const mockCareTarget: CareTarget = {
  id: 'target_mock_01',
  name: '김영희',
  relation: '어머니',
};
