import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// 익명 로그인: 이름·이메일 없이 이 기기(브라우저)에 고유번호(uid)만 붙여요.
// 보안 규칙이 이 uid로 개설자·수정자·조회자를 구분해요. 같은 브라우저에서는 uid가 유지돼요.
let readyPromise = null;
export function ensureSignedIn() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await auth.authStateReady(); // 저장돼 있던 로그인 상태를 먼저 불러와요(새 uid가 생기지 않게)
      if (auth.currentUser) return auth.currentUser;
      const cred = await signInAnonymously(auth);
      return cred.user;
    })().catch((e) => {
      readyPromise = null;
      throw e;
    });
  }
  return readyPromise;
}
