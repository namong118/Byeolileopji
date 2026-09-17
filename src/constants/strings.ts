/**
 * 브랜드 문구. UI 에서는 절대 기술 용어(PIR, motion_detected 등)를 노출하지 않는다.
 */

export const brand = {
  name: '별일없지',
  nameEn: 'Byeolil Eopji',
  message: '별일 없는 하루를 위해.',
  /** 홈 최상단 핵심 질문 (Phase 6) — 2~3초 안에 답을 얻는다는 목표의 앵커 문구. */
  question: '오늘 부모님, 별일 없지?',
} as const;

export const labels = {
  homeTab: '홈',
  timelineTab: '오늘의 기록',
  developerTab: '개발자',

  atGlance: '한눈에 보기',
  lastActivity: '최근 활동',
  homeDevice: '집 안 기기',
  lastChecked: '마지막 확인',
  todayActivity: '오늘 활동',
  /** Home 미리보기 섹션 제목 — Timeline 탭 자체의 "오늘의 기록" 과는 다른 문구 */
  homeFlow: '오늘의 흐름',
  todayTimeline: '오늘의 기록',
  viewAllTimeline: '전체 기록 보기',

  atHome: '집에 있어요',
  away: '외출 중이에요',
} as const;
