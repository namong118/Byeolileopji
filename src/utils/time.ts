/** 날짜/시간 표시 유틸. 외부 라이브러리 없이 한국어 표기를 만든다. */

export function toDate(iso: string): Date {
  return new Date(iso);
}

/**
 * "오전 7:10" / "오후 4:32" 형태.
 * 보호자용 화면에서 시각을 표시할 때 쓰는 **표준 포맷** (홈·타임라인 공통).
 */
export function formatClock(iso: string): string {
  const d = toDate(iso);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const isAm = hours < 12;
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mm = minutes.toString().padStart(2, '0');
  return `${isAm ? '오전' : '오후'} ${h12}:${mm}`;
}

/** "9월 6일 토요일" 형태 (홈 헤더 날짜) */
export function formatKoreanDate(date: Date = new Date()): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return `${month}월 ${day}일 ${weekday}요일`;
}

/**
 * "방금" / "12분 전" / "3시간 12분 전" / "5시간 전" / "2일 전" 형태.
 * formatRelative 보다 시/분을 함께 보여줘 보호자가 경과 시간을 가늠하기 쉽다.
 */
export function formatRelativeDetailed(
  iso: string,
  now: Date = new Date(),
): string {
  const diffMin = Math.floor((now.getTime() - toDate(iso).getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    const restMin = diffMin % 60;
    return restMin > 0 ? `${diffHour}시간 ${restMin}분 전` : `${diffHour}시간 전`;
  }

  return `${Math.floor(diffHour / 24)}일 전`;
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
