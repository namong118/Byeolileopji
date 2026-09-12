/**
 * guardianLinks 문서 — **순수 헬퍼** (Phase 5 STEP 5.2).
 *
 * firebase / expo / react import 없음 → Node 스모크에서 단독 실행 가능.
 * 실제 Firestore 조회는 `firestore/guardianLinkRepository.ts`.
 *
 *   guardianLinks/{guardianUid}_{careRecipientId}
 *   { guardianUid, careRecipientId, role: "guardian", enabled, createdAt, updatedAt }
 *
 * composite id 를 쓰는 이유: Firestore Rules 헬퍼(`isGuardianOf`)가 query 없이
 * 단일 `exists()` 로 끝난다 (Phase 5.3). 단, 앱은 자신의 careRecipientId 를 미리
 * 모르므로 discovery 는 `guardianUid` 단일 필드 쿼리로 한다 (repository 쪽 책임).
 */

export interface GuardianLinkDoc {
  guardianUid: string;
  careRecipientId: string;
  role?: string;
  enabled: boolean;
}

/** `{guardianUid}_{careRecipientId}` 결정론적 문서 id. 개발용 문서 수동 생성 시에도 이 형식을 쓴다. */
export function buildGuardianLinkId(
  guardianUid: string,
  careRecipientId: string,
): string {
  const uid = typeof guardianUid === 'string' ? guardianUid.trim() : '';
  if (uid === '') throw new Error('buildGuardianLinkId: guardianUid required');

  const rid = typeof careRecipientId === 'string' ? careRecipientId.trim() : '';
  if (rid === '') throw new Error('buildGuardianLinkId: careRecipientId required');

  return `${uid}_${rid}`;
}

/**
 * Firestore 문서(평문 fields) → 검증된 GuardianLinkDoc, 또는 malformed 면 null.
 * (throw 하지 않는다 — 목록 조회 결과에서 조용히 걸러낸다. 개별 문서 오염이 전체 조회를
 *  막으면 안 된다.)
 */
export function parseGuardianLinkDoc(
  fields: Record<string, unknown>,
): GuardianLinkDoc | null {
  const guardianUid =
    typeof fields.guardianUid === 'string' ? fields.guardianUid : '';
  const careRecipientId =
    typeof fields.careRecipientId === 'string' ? fields.careRecipientId : '';
  if (guardianUid === '' || careRecipientId === '') return null;

  return {
    guardianUid,
    careRecipientId,
    role: typeof fields.role === 'string' ? fields.role : undefined,
    // 없으면 활성으로 간주 (pushTokenStore.js 의 enabled 처리와 동일 패턴).
    enabled: fields.enabled !== false,
  };
}

/**
 * 여러 guardianLinks 후보 중 하나를 **결정론적으로** 고른다 (careRecipientId 오름차순 1번째).
 *
 * 링크가 하나도 없으면(또는 전부 enabled:false) **null** — 절대 개발용 고정 대상으로
 * 조용히 fallback 하지 않는다. 이것이 이 프로젝트의 핵심 보안 경계다: "링크 없음" 은
 * 항상 명시적인 "연결된 돌봄 대상이 없습니다" 상태로 이어져야 한다.
 */
export function selectActiveLink(
  links: readonly GuardianLinkDoc[],
): GuardianLinkDoc | null {
  const enabled = links.filter((l) => l.enabled);
  if (enabled.length === 0) return null;

  const sorted = [...enabled].sort((a, b) =>
    a.careRecipientId.localeCompare(b.careRecipientId),
  );
  return sorted[0];
}
