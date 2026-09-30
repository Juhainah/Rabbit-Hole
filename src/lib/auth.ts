import type { Auth } from 'firebase/auth';
import { create } from 'zustand';

// Sign-in with Google through Firebase. These values identify the Firebase
// project and are meant to be in the web page; they are not secrets. What keeps
// the site safe is the server checking every request's sign-in ticket.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Without a Firebase project (local use), there's no sign-in at all. */
export const authEnabled = !!(config.apiKey && config.projectId);

interface AuthState {
  status: 'off' | 'loading' | 'signed-out' | 'signed-in';
  name?: string;
  email?: string;
  photo?: string;
  error?: string;
  busy?: boolean;
}

export const useAuth = create<AuthState>(() => ({ status: authEnabled ? 'loading' : 'off' }));

let ready: Promise<Auth> | null = null;

/** Firebase loads only when sign-in is on, so local use stays light. */
function firebaseAuth() {
  ready ??= (async () => {
    const [{ initializeApp }, fa] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
    const auth = fa.getAuth(initializeApp(config));
    fa.onAuthStateChanged(auth, (u) =>
      useAuth.setState(
        u
          ? { status: 'signed-in', name: u.displayName ?? undefined, email: u.email ?? undefined, photo: u.photoURL ?? undefined, error: undefined, busy: false }
          : { status: 'signed-out', name: undefined, email: undefined, photo: undefined, busy: false },
      ),
    );
    return auth;
  })();
  return ready;
}

if (authEnabled) firebaseAuth().catch(() => useAuth.setState({ status: 'signed-out', error: "Sign-in couldn't load. Check your connection and refresh." }));

const friendly = (code: string) =>
  code === 'auth/unauthorized-domain'
    ? "This web address isn't allowed to sign in yet. Add it under Authentication → Settings → Authorized domains in Firebase."
    : code === 'auth/network-request-failed'
      ? 'No connection. Check your internet and try again.'
      : 'Sign-in failed. Try again.';

export async function signIn() {
  const fa = await import('firebase/auth');
  const auth = await firebaseAuth();
  useAuth.setState({ busy: true, error: undefined });
  try {
    await fa.signInWithPopup(auth, new fa.GoogleAuthProvider());
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked') return fa.signInWithRedirect(auth, new fa.GoogleAuthProvider());
    const closed = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
    useAuth.setState({ busy: false, error: closed ? undefined : friendly(code) });
  }
}

export async function signOut() {
  const fa = await import('firebase/auth');
  await fa.signOut(await firebaseAuth());
}

/** The current sign-in ticket for API calls (Firebase refreshes it hourly). */
export async function idToken(): Promise<string | undefined> {
  if (!authEnabled) return undefined;
  const auth = await firebaseAuth();
  await auth.authStateReady();
  return auth.currentUser?.getIdToken();
}
