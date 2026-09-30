import { createRemoteJWKSet, jwtVerify } from 'jose';

// Sign-in is Supabase's job; the server only checks the ticket each request carries.
// Tickets are verified against the project's published keys, so no secret is needed.

const supabaseUrl = () => (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const anonKey = () => (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim();

/** The Supabase project visitors sign in to. Empty means sign-in is off (local use). */
export const authProject = () => supabaseUrl();

export interface Visitor {
  uid: string;
  email?: string;
  verified: boolean;
}

let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
let keysFor = '';
// A checked ticket is trusted for a few minutes, so a dig's burst of requests costs one check.
const checked = new Map<string, { visitor: Visitor | null; until: number }>();

/** Reads and checks a Supabase access token from an Authorization header. */
export async function verifyVisitor(header: string | undefined): Promise<Visitor | null> {
  const base = supabaseUrl();
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!base || !token) return null;
  const hit = checked.get(token);
  if (hit && hit.until > Date.now()) return hit.visitor;

  let visitor: Visitor | null = null;
  try {
    if (keysFor !== base) {
      keys = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
      keysFor = base;
    }
    const { payload } = await jwtVerify(token, keys!, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
    if (payload.sub) visitor = { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined, verified: true };
  } catch {
    // Projects still signing with the older shared secret: ask Supabase who this is instead.
    try {
      const res = await fetch(`${base}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey() }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const u = (await res.json()) as { id?: string; email?: string; email_confirmed_at?: string; confirmed_at?: string };
        if (u.id) visitor = { uid: u.id, email: u.email?.toLowerCase(), verified: !!(u.email_confirmed_at || u.confirmed_at) };
      }
    } catch {
      /* treated as signed out */
    }
  }
  checked.set(token, { visitor, until: Date.now() + (visitor ? 5 * 60_000 : 30_000) });
  if (checked.size > 1000) checked.delete(checked.keys().next().value!);
  return visitor;
}

/** ALLOWED_EMAILS=a@x.com,b@y.com keeps the site to a guest list. Empty lets anyone signed in use it. */
export function onGuestList(v: Visitor) {
  const list = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !list.length || (!!v.email && v.verified && list.includes(v.email));
}
