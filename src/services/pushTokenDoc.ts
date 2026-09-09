/**
 * pushTokens 문서 — **순수 헬퍼** (Phase 4.4 STEP 1).
 *
 * firebase / expo / react import 없음 → Worker(esbuild) · Node 스모크 · 앱 모두 import 가능.
 * 실제 등록 흐름(native 토큰 획득 + Firestore write)은 `pushRegistration.ts`.
 */

export type PushPlatform = 'android' | 'ios' | 'web' | 'unknown';

/** Firestore `pushTokens/{id}` 문서의 평문 형태 (timestamp 제외 — 호출부가 serverTimestamp 로 채운다). */
export interface PushTokenDocInput {
  token: string;
  platform: PushPlatform;
  careRecipientId: string;
  enabled: true;
}

/**
 * 등록 입력 검증 + 정규화.
 *
 * @throws token 이 비었거나 careRecipientId 가 비었으면.
 */
export function buildPushTokenDoc(input: {
  token: unknown;
  platform: unknown;
  careRecipientId: unknown;
}): PushTokenDocInput {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (token === '') throw new Error('buildPushTokenDoc: token required');

  const careRecipientId =
    typeof input.careRecipientId === 'string' ? input.careRecipientId.trim() : '';
  if (careRecipientId === '') throw new Error('buildPushTokenDoc: careRecipientId required');

  const raw = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : '';
  const platform: PushPlatform =
    raw === 'android' || raw === 'ios' || raw === 'web' ? raw : 'unknown';

  return { token, platform, careRecipientId, enabled: true };
}

/**
 * 토큰 문자열에서 **안정적인** 문서 id (FNV-1a 32-bit hex).
 * 같은 기기(같은 토큰) → 같은 문서 → 재등록해도 중복 문서가 안 쌓인다.
 *
 * ⚠️ 32-bit 라 이론적 충돌 가능. 보호자 수가 적은 PoC 에서는 무시 가능하고,
 *    Auth 도입 시 `guardianUid` 기반 id 로 대체한다.
 */
export function pushTokenDocId(platform: string, token: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  const p = platform && /^[a-z]+$/.test(platform) ? platform : 'x';
  return `${p}-${hex}`;
}
