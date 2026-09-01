/**
 * CareEvent -> 사용자에게 보여줄 한국어 문장.
 *
 * UI 컴포넌트는 이벤트 타입을 직접 해석하지 않고 항상 이 함수를 통한다.
 */

import type { CareEvent, EventType } from '../types/events';

interface PresentedEvent {
  /** 타임라인 한 줄 문구 */
  message: string;
  /** 홈 "마지막 활동" 요약처럼 짧게 쓸 때 */
  shortMessage: string;
}

export function presentEvent(event: CareEvent): PresentedEvent {
  const place = event.location ?? '집';

  switch (event.eventType) {
    case 'motion_detected':
      return {
        message: `${place}에서 활동이 확인됐어요.`,
        shortMessage: `${place}에서 활동`,
      };
    case 'door_opened':
      return {
        message: '현관문이 열렸어요.',
        shortMessage: '현관문 열림',
      };
    case 'left_home':
      return {
        message: '외출했어요.',
        shortMessage: '외출',
      };
    case 'returned_home':
      return {
        message: '집에 돌아오셨어요.',
        shortMessage: '귀가',
      };
    case 'medication_taken':
      return {
        message: '약을 챙겨 드셨어요.',
        shortMessage: '복약 완료',
      };
    case 'medication_missed':
      return {
        message: '예정된 복약을 아직 못 하셨어요.',
        shortMessage: '복약 미완료',
      };
    case 'watch_activity':
      return {
        message: '스마트워치에서 움직임이 확인됐어요.',
        shortMessage: '워치 활동',
      };
    case 'sos_triggered':
      return {
        message: '긴급 요청(SOS)이 들어왔어요.',
        shortMessage: 'SOS 요청',
      };
    default:
      return exhaustiveFallback(event.eventType);
  }
}

/** "오늘 첫 활동" 같은 특별 문구가 필요할 때 타임라인에서 사용 */
export function presentFirstActivityOfDay(): string {
  return '오늘 첫 활동이 확인됐어요.';
}

function exhaustiveFallback(_type: EventType): PresentedEvent {
  return { message: '활동이 확인됐어요.', shortMessage: '활동' };
}
