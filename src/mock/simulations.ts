/**
 * 개발자 시뮬레이션 화면의 버튼 정의.
 *
 * 각 버튼은 현재 시각으로 새로운 CareEvent 입력을 만든다.
 * Production 빌드에서는 이 화면과 함께 통째로 숨기면 된다.
 */

import type { NewCareEvent } from '../types/events';

export interface SimulationButton {
  key: string;
  label: string;
  build: () => NewCareEvent;
}

export const SIMULATION_BUTTONS: SimulationButton[] = [
  {
    key: 'motion_living_room',
    label: '거실 움직임',
    build: () => ({ eventType: 'motion_detected', source: 'sensor', location: '거실' }),
  },
  {
    key: 'door_opened',
    label: '현관문 열림',
    build: () => ({ eventType: 'door_opened', source: 'sensor', location: '현관' }),
  },
  {
    key: 'left_home',
    label: '외출',
    build: () => ({ eventType: 'left_home', source: 'sensor' }),
  },
  {
    key: 'returned_home',
    label: '귀가',
    build: () => ({ eventType: 'returned_home', source: 'sensor' }),
  },
  {
    key: 'medication_taken',
    label: '복약 완료',
    build: () => ({ eventType: 'medication_taken', source: 'medication' }),
  },
  {
    key: 'medication_missed',
    label: '복약 미완료',
    build: () => ({ eventType: 'medication_missed', source: 'medication' }),
  },
  {
    key: 'watch_activity',
    label: '워치 활동',
    build: () => ({ eventType: 'watch_activity', source: 'watch' }),
  },
  {
    key: 'sos_triggered',
    label: 'SOS 발생',
    build: () => ({ eventType: 'sos_triggered', source: 'watch' }),
  },
];
