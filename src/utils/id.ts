/** 로컬 목업용 간단한 고유 ID 생성기. Phase 2 에서 DB PK 로 교체된다. */

let counter = 0;

export function createId(prefix = 'evt'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
}
