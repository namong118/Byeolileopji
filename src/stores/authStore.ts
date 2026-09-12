/**
 * Firebase Auth 상태 — Phase 5 STEP 5.1.
 *
 *   app/_layout.tsx  →  authStore.init()  →  onAuthStateChanged
 *        ↓
 *   user: null(로그아웃) | User(로그인)
 *        ↓
 *   Stack.Protected 가 login ↔ (tabs) 를 가른다.
 *
 * guardian 관계 모델(guardianLinks)은 STEP 5.2. 여기서는 "로그인했는가" 만 안다.
 */

import { create } from 'zustand';
// @firebase/auth 직접 사용 이유: src/lib/firebase.ts 상단 주석 참고
// (firebase/auth 래퍼의 exports 맵에 "react-native" 조건이 없는 v12.18.0 버그).
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from '@firebase/auth';

import { getFirebaseAuth } from '../lib/firebase';
import { describeAuthError } from '../services/authErrors';

interface AuthState {
  /** 로그인한 Firebase 사용자. null = 로그아웃 상태. undefined = 아직 판단 전(auth 미설정 등)과 구분하지 않는다 — authLoading 으로 구분. */
  user: User | null;
  /** true = 최초 onAuthStateChanged 응답 전. 이 동안 guardian 화면을 노출하지 않는다. */
  authLoading: boolean;
  authError?: string;
  signingIn: boolean;

  /** onAuthStateChanged 구독 시작 (앱 부팅 시 1회). */
  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  clearAuthError: () => void;
  teardown: () => void;
}

let authUnsub: (() => void) | undefined;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authLoading: true,
  authError: undefined,
  signingIn: false,

  init: () => {
    if (authUnsub) return; // 이미 구독 중 (중복 방지)

    const auth = getFirebaseAuth();
    if (!auth) {
      // Firebase 미설정 — InMemory 개발 모드와 동일하게 취급. 로그인 화면은 그대로 뜬다.
      set({ user: null, authLoading: false });
      return;
    }

    authUnsub = onAuthStateChanged(auth, (user) => {
      set({ user, authLoading: false });
    });
  },

  signIn: async (email, password) => {
    set({ signingIn: true, authError: undefined });
    const auth = getFirebaseAuth();
    if (!auth) {
      set({ signingIn: false, authError: 'Firebase 가 설정되지 않았어요.' });
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      set({ signingIn: false });
    } catch (error) {
      set({ signingIn: false, authError: describeAuthError(error) });
    }
  },

  signOutUser: async () => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    await signOut(auth);
  },

  clearAuthError: () => set({ authError: undefined }),

  teardown: () => {
    authUnsub?.();
    authUnsub = undefined;
  },
}));
