/**
 * 앱 시작 시 주입되는 "오늘의 하루" 목업 이벤트.
 *
 * - 가장 최근 활동은 항상 몇 분 전이 되도록 현재 시각 기준 상대 오프셋을 쓴다.
 * - 나머지 이벤트도 상대 오프셋으로 배치하되, 자정을 넘겨 "어제"가 되지 않도록
 *   오늘 0시로 clamp 한다. (데모가 언제 실행돼도 타임라인이 오늘 안에 들어온다.)
 */

import type { CareEvent } from '../types/events';
import { createId } from '../utils/id';
import { DEV_CARE_RECIPIENT_ID, DEV_DEVICE_ID } from '../config/careContext';

interface SeedSpec {
  minutesAgo: number;
  eventType: CareEvent['eventType'];
  source: CareEvent['source'];
  location?: string;
}

const SEED_SPECS: SeedSpec[] = [
  { minutesAgo: 12, eventType: 'motion_detected', source: 'sensor', location: '거실' },
  { minutesAgo: 60 * 2 + 24, eventType: 'returned_home', source: 'sensor' },
  { minutesAgo: 60 * 6 + 11, eventType: 'left_home', source: 'sensor' },
  { minutesAgo: 60 * 8 + 27, eventType: 'medication_taken', source: 'medication' },
  { minutesAgo: 60 * 9, eventType: 'motion_detected', source: 'sensor', location: '침실' },
];

export function buildSeedEvents(now: Date = new Date()): CareEvent[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const placed = SEED_SPECS.map((spec, index) => {
    let occurredMs = now.getTime() - spec.minutesAgo * 60_000;
    // 가장 최근 이벤트(index 0)를 제외하고는 오늘 안에 머물도록 clamp.
    if (index > 0 && occurredMs < startOfToday.getTime()) {
      // 0시 이후로 1분 간격씩 밀어넣어 순서를 보존한다.
      occurredMs = startOfToday.getTime() + (SEED_SPECS.length - index) * 60_000;
    }
    return {
      id: createId('seed'),
      eventType: spec.eventType,
      source: spec.source,
      location: spec.location,
      occurredAt: new Date(occurredMs).toISOString(),
      careRecipientId: DEV_CARE_RECIPIENT_ID,
      deviceId: spec.source === 'sensor' ? DEV_DEVICE_ID : undefined,
    };
  });

  return placed;
}
