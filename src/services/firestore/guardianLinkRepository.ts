/**
 * Firestore `guardianLinks` 조회 — Phase 5 STEP 5.2.
 *
 *   guardianStore.resolveLink(uid) → queryGuardianLinksByUid(db, uid) → Firestore
 *
 * `guardianUid == uid` 단일 필드 쿼리만 쓴다. `enabled` 복합 필터는 넣지 않는다
 * (새 복합 인덱스가 필요해진다) — `parseGuardianLinkDoc`/`selectActiveLink` 가
 * 코드에서 걸러낸다 (기존 `pushTokenStore.js` 의 `enabled` 처리와 동일 패턴).
 *
 * 문서를 앱이 직접 만들지 않는다 — Phase 5.2 에서는 Firebase Console 수동 생성만
 * 지원한다 (Rules 도 아직 열려 있어 client mutation 을 막지 않지만, 이 저장소는
 * write 메서드를 아예 제공하지 않는다).
 */

import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';

import { parseGuardianLinkDoc, type GuardianLinkDoc } from '../guardianLink';

const GUARDIAN_LINKS_COLLECTION = 'guardianLinks';

/** [STEP 5.2 진단용] uid 전체를 로그에 남기지 않는다. */
function redactUid(uid: string): string {
  return `${uid.slice(0, 6)}…(len ${uid.length})`;
}

/** 로그인 UID 로 guardianLinks 를 조회한다. malformed 문서는 조용히 걸러진다. */
export async function queryGuardianLinksByUid(
  db: Firestore,
  guardianUid: string,
): Promise<GuardianLinkDoc[]> {
  const q = query(
    collection(db, GUARDIAN_LINKS_COLLECTION),
    where('guardianUid', '==', guardianUid),
  );

  if (__DEV__) {
    // [STEP 5.2 진단용 임시 로그] "조회 실패" 와 "링크 0개" 를 반드시 구분한다.
    console.log(
      `[별일없지][diag] guardianLinks query 시작 guardianUid=${redactUid(guardianUid)}`,
    );
  }

  let snap;
  try {
    snap = await getDocs(q);
  } catch (error) {
    if (__DEV__) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'unknown';
      console.error(
        `[별일없지][diag] guardianLinks query 실패(throw) code=${code} — permission/index 오류일 가능성. ` +
          `"연결 없음" 과는 다른 상황이다.`,
        error,
      );
    }
    throw error; // 조용히 삼키지 않는다 — 호출자(guardianStore)가 linkError 로 구분해 처리한다.
  }

  if (__DEV__) {
    console.log(
      `[별일없지][diag] guardianLinks query 성공, rawDocs=${snap.size}건`,
    );
  }

  const out: GuardianLinkDoc[] = [];
  for (const d of snap.docs) {
    const parsed = parseGuardianLinkDoc(d.data());
    if (__DEV__) {
      console.log(
        `[별일없지][diag] doc id=${d.id} parse=${parsed ? 'OK' : 'REJECTED(guardianUid/careRecipientId 누락 또는 타입 불일치)'}` +
          (parsed ? ` careRecipientId=${parsed.careRecipientId} enabled=${parsed.enabled}` : ''),
      );
    }
    if (parsed) out.push(parsed);
  }

  if (__DEV__) {
    console.log(
      `[별일없지][diag] guardianLinks 파싱 결과 ${out.length}/${snap.size}건 통과`,
    );
  }

  return out;
}
