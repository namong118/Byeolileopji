/**
 * 브랜드 문구. UI 에서는 절대 기술 용어(PIR, motion_detected 등)를 노출하지 않는다.
 */

export const brand = {
  name: '별일없지',
  nameEn: 'Byeolil Eopji',
  message: '별일 없는 하루를 위해.',
} as const;

export const labels = {
  homeTab: '홈',
  timelineTab: '오늘의 기록',
  developerTab: '개발자',

  lastActivity: '마지막 활동',
  todayActivity: '오늘 활동',
  todayTimeline: '오늘의 기록',
  viewAllTimeline: '전체 기록 보기',

  atHome: '집에 있어요',
  away: '외출 중이에요',
} as const;
