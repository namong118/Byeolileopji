/** 날짜/시간 표시 유틸. 외부 라이브러리 없이 한국어 표기를 만든다. */

export function toDate(iso: string): Date {
  return new Date(iso);
}

/** "오후 4:32" 형태 */
export function formatClock(iso: string): string {
  const d = toDate(iso);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const isAm = hours < 12;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mm = minutes.toString().padStart(2, '0');
  return `${isAm ? '오전' : '오후'} ${h12}:${mm}`;
}

/** "16:32" 형태 (타임라인용 24시간) */
export function formatHour24(iso: string): string {
  const d = toDate(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

/** "12분 전", "3시간 전", "방금" 형태 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - toDate(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
