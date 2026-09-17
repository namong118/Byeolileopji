/**
 * DeviceHealth(내부 enum) → 보호자 홈에 보여줄 "센서 연결" 행.
 *
 * 홈에는 online / offline / unknown, heartbeat_fresh / heartbeat_stale, reason 같은
 * 개발자 문자열을 절대 노출하지 않는다. 여기서 사람이 읽는 문장으로만 바꾼다.
 * (careStatusText.ts 와 같은 철학 — 규칙 엔진은 문구를 만들지 않는다.)
 *
 *  - online  → "정상"
 *              사람 축이 CHECK 면 "정상 · 신호는 계속 오고 있어요" —
 *              "사람이 한동안 조용한 것" 과 "센서가 고장 난 것" 을 분명히 구분한다.
 *  - offline → "신호가 끊겼어요"
 *  - unknown → null (초기 로딩 / heartbeat 미수신. 장애가 아니므로 행 자체를 숨긴다)
 */

import type { CareStatus, DeviceHealth } from '../types/status';

export interface StatusRow {
  label: string;
  value: string;
}

export function presentSensorRow(
  health: DeviceHealth,
  personStatus: CareStatus,
): StatusRow | null {
  switch (health) {
    case 'online':
      return {
        label: '센서 연결',
        value:
          personStatus === 'CHECK'
            ? '정상 · 신호는 계속 오고 있어요'
            : '정상',
      };
    case 'offline':
      return { label: '센서 연결', value: '신호가 끊겼어요' };
    case 'unknown':
    default:
      return null;
  }
}

export interface DeviceSummaryCard {
  value: string;
  secondary?: string;
}

/**
 * "한눈에 보기" 그리드의 "집 안 기기" 카드 전용 문구.
 * offline/unknown 을 굳이 구분해 보여주지 않는다 — 둘 다 "연결 확인 중"으로 뭉뚱그려
 * 차분하게 표현한다(기기 상태를 사람의 안부 위험처럼 보이지 않게 하기 위해서다).
 */
export function presentDeviceSummaryCard(
  health: DeviceHealth,
): DeviceSummaryCard {
  if (health === 'online') return { value: '정상', secondary: '연결됨' };
  return { value: '연결 확인 중', secondary: '확인 필요' };
}
