import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';

// Sign-in through Supabase (GitHub / Google). The project URL and the anon
// ("publishable") key are meant to be in the web page; they are not secrets.
// What keeps the site safe is the server checking every request's sign-in ticket.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** Without a Supabase project (local use), there's no sign-in at all. */
export const authEnabled = !!(url && anonKey);

/** Which sign-in buttons to show: VITE_AUTH_PROVIDERS=github,google (GitHub alone by default). */
export const AUTH_PROVIDERS = ((import.meta.env.VITE_AUTH_PROVIDERS as string | undefined) ?? 'github')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p): p is 'github' | 'google' => p === 'github' || p === 'google');

interface AuthState {
  status: 'off' | 'loading' | 'signed-out' | 'signed-in';
  name?: string;
  email?: string;
  photo?: string;
  error?: string;
  busy?: 'github' | 'google';
}

export const useAuth = create<AuthState>(() => ({ status: authEnabled ? 'loading' : 'off' }));

let ready: Promise<SupabaseClient> | null = null;

/** Supabase loads only when sign-in is on, so local use stays light. */
function client() {
  ready ??= (async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url!, anonKey!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const apply = (user: { email?: string; user_metadata?: Record<string, string> } | null | undefined) =>
      useAuth.setState(
        user
          ? {
              status: 'signed-in',
              email: user.email,
              name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.user_metadata?.user_name,
              photo: user.user_metadata?.avatar_url,
              error: undefined,
              busy: undefined,
            }
          : { status: 'signed-out', name: undefined, email: undefined, photo: undefined, busy: undefined },
      );
    sb.auth.onAuthStateChange((_event, session) => apply(session?.user));
    const { data } = await sb.auth.getSession();
    apply(data.session?.user);
    // Coming back from GitHub/Google with an error in the address bar: say it plainly.
    const back = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
    if (back.get('error_description')) useAuth.setState({ error: `Sign-in didn't finish: ${back.get('error_description')}` });
    return sb;
  })();
  return ready;
}

if (authEnabled) client().catch(() => useAuth.setState({ status: 'signed-out', error: "Sign-in couldn't load. Check your connection and refresh." }));

export async function signIn(provider: 'github' | 'google') {
  useAuth.setState({ busy: provider, error: undefined });
  try {
    const sb = await client();
    // Leaves for GitHub/Google and comes back here signed in.
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    if (error) throw error;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    useAuth.setState({
      busy: undefined,
      error: /not enabled|unsupported provider/i.test(m) ? `${provider === 'github' ? 'GitHub' : 'Google'} sign-in isn't switched on in Supabase yet.` : 'Sign-in failed. Try again.',
    });
  }
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}

/** The current sign-in ticket for API calls (Supabase refreshes it before it expires). */
export async function idToken(): Promise<string | undefined> {
  if (!authEnabled) return undefined;
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token;
}
