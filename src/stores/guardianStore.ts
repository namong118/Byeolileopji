/**
 * Guardian ↔ CareRecipient 관계 상태 — Phase 5 STEP 5.2.
 *
 *   app/_layout.tsx  (user 로그인 확정)
 *        ↓  resolveLink(user.uid)
 *   guardianLinks 조회 → selectActiveLink()
 *        ↓
 *   careRecipientId: string | null   (+ linkError 로 "조회 실패" 를 별도 구분)
 *        ↓
 *   careStore.init(careRecipientId)   (null 이면 호출 안 함 — "연결된 돌봄 대상이 없습니다")
 *
 * 링크가 없으면 **절대** DEV_CARE_RECIPIENT_ID 로 몰래 대체하지 않는다 (guardianLink.ts
 * selectActiveLink() 의 계약). 이 스토어는 그 계약을 그대로 상태에 반영만 한다.
 *
 * `careRecipientId: null` 은 두 가지 서로 다른 상황에서 발생하므로 `linkError` 로
 * 반드시 구분한다:
 *   - 조회 성공, 링크 0개(또는 전부 enabled:false)  → linkError 없음 → "연결 없음" 화면
 *   - 조회 자체가 실패(permission-denied 등)          → linkError 있음 → "조회 실패" 화면 + 재시도
 */

import { create } from 'zustand';

import { getFirestoreDb } from '../lib/firebase';
import { queryGuardianLinksByUid } from '../services/firestore/guardianLinkRepository';
import { selectActiveLink } from '../services/guardianLink';
import { DEV_CARE_RECIPIENT_ID } from '../config/careContext';

interface GuardianState {
  /**
   * null = "아직 해석 전"(linkLoading 로 구분) 또는 "조회 완료, 연결 없음"(linkError
   * 없을 때만 그렇게 해석한다 — linkError 가 있으면 "조회 자체 실패").
   */
  careRecipientId: string | null;
  /** true = 최초 resolveLink() 완료 전. 이 동안 "연결 없음"/"조회 실패" 화면을 보여주면 안 된다. */
  linkLoading: boolean;
  /** 있으면 "조회 성공, 링크 없음"이 아니라 "조회 자체가 실패"했다는 뜻 (permission-denied 등). */
  linkError?: string;

  resolveLink: (guardianUid: string) => Promise<void>;
  /** 로그아웃 시 app/_layout.tsx 가 호출한다 — 다음 로그인이 깨끗한 상태에서 시작하도록. */
  reset: () => void;
}

export const useGuardianStore = create<GuardianState>((set) => ({
  careRecipientId: null,
  linkLoading: true,
  linkError: undefined,

  resolveLink: async (guardianUid) => {
    set({ linkLoading: true, linkError: undefined });

    const db = getFirestoreDb();
    if (!db) {
      // Firestore 미설정 — InMemory 개발 모드. guardian 관계 모델이 적용될 실제 백엔드가
      // 없으므로 기존 개발용 고정 대상을 그대로 쓴다 (실제 Firebase 프로젝트에서는
      // isFirebaseConfigured() 가 항상 true 라 이 분기를 타지 않는다).
      set({ careRecipientId: DEV_CARE_RECIPIENT_ID, linkLoading: false });
      return;
    }

    try {
      const links = await queryGuardianLinksByUid(db, guardianUid);
      if (__DEV__) {
        // [STEP 5.2 진단용 임시 로그] uid 전체는 남기지 않고 일치 여부만 확인한다.
        for (const link of links) {
          console.log(
            `[별일없지][diag] link careRecipientId=${link.careRecipientId} enabled=${link.enabled} sameUid=${link.guardianUid === guardianUid}`,
          );
        }
      }
      const active = selectActiveLink(links);
      if (__DEV__) {
        console.log(
          `[별일없지][diag] resolveLink 결과 → careRecipientId=${active?.careRecipientId ?? 'null(연결 없음)'} (links=${links.length}건 중 선택)`,
        );
      }
      set({ careRecipientId: active?.careRecipientId ?? null, linkLoading: false });
    } catch (error) {
      // 조회 자체가 실패(permission-denied 등)한 경우 careRecipientId 는 null 로
      // 두지만 linkError 를 반드시 함께 세팅한다 — app/_layout.tsx 는 linkError 유무로
      // "조회 실패"(app/link-error.tsx) 와 "조회 성공, 링크 없음"(app/no-recipient.tsx) 을
      // 서로 다른 화면으로 분리한다.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'unknown';
      if (__DEV__) {
        console.error(
          `[별일없지][diag] guardianLinks 조회 실패 code=${code} — "연결 없음" 화면으로 귀결되지만 실제로는 쿼리 실패다.`,
          error,
        );
      }
      set({
        careRecipientId: null,
        linkLoading: false,
        linkError: `연결 정보를 불러오지 못했어요. (code=${code}) 네트워크 연결을 확인하고 다시 시도해 주세요.`,
      });
    }
  },

  reset: () => set({ careRecipientId: null, linkLoading: true, linkError: undefined }),
}));
