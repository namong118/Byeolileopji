/**
 * 1초 주기로 now 를 갱신하며 computePostureAlert 를 다시 계산한다.
 * 펌웨어는 자세가 바뀔 때만 전송하므로, 누운 뒤 경과 시간은 이벤트가 아니라 타이머로 센다.
 */
import { useEffect, useMemo, useState } from 'react';

import { DEMO_LYING_ALERT_MS } from '../../config/demoMode';
import { useCareStore } from '../../stores/careStore';
import { computePostureAlert, type PostureAlert } from '../../utils/posture';

export function usePostureAlert(): PostureAlert {
  const events = useCareStore((s) => s.events);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return useMemo(() => computePostureAlert(events, now, DEMO_LYING_ALERT_MS), [events, now]);
}
