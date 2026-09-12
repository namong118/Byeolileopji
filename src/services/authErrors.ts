/**
 * Firebase Auth 에러 코드 → 사용자 문구 매핑 — **순수 헬퍼** (Phase 5 STEP 5.1).
 *
 * firebase / expo / react import 없음 → Node 스모크에서 단독 실행 가능.
 * 실제 Firebase 에러 객체를 다루는 부분은 authStore.ts.
 */

/** 잘못된 이메일/비밀번호로 취급해 동일한 안내 문구를 보여줄 코드들. */
const INVALID_CREDENTIAL_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-email',
  'auth/user-not-found',
  'auth/wrong-password',
]);

/**
 * Firebase 에러(또는 알 수 없는 값)에서 `code` 문자열을 안전하게 뽑는다.
 * 없으면 빈 문자열.
 */
export function extractAuthErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  }
  return '';
}

/**
 * Firebase Auth 에러 → 한국어 안내 문구.
 * 내부 코드/스택은 절대 그대로 노출하지 않는다 (사용자에게 불필요한 기술 정보).
 */
export function describeAuthError(error: unknown): string {
  const code = extractAuthErrorCode(error);

  if (INVALID_CREDENTIAL_CODES.has(code)) {
    return '이메일 또는 비밀번호가 올바르지 않아요.';
  }
  if (code === 'auth/too-many-requests') {
    return '잠시 후 다시 시도해 주세요.';
  }
  return '로그인에 실패했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.';
}
