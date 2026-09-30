import { createRemoteJWKSet, jwtVerify } from 'jose';

// Sign-in is Firebase's job; the server only checks the ticket each request carries.
// Google publishes the keys Firebase signs with, so no service account is needed.
const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

/** The Firebase project visitors sign in to. Empty means sign-in is off (local use). */
export const authProject = () => (process.env.VITE_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? '').trim();

export interface Visitor {
  uid: string;
  email?: string;
  verified: boolean;
}

/** Reads and checks a Firebase ID token from an Authorization header. */
export async function verifyVisitor(header: string | undefined): Promise<Visitor | null> {
  const project = authProject();
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!project || !token) return null;
  try {
    const { payload } = await jwtVerify(token, GOOGLE_KEYS, {
      issuer: `https://securetoken.google.com/${project}`,
      audience: project,
      algorithms: ['RS256'],
    });
    if (!payload.sub || (typeof payload.auth_time === 'number' && payload.auth_time * 1000 > Date.now() + 60_000)) return null;
    return { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined, verified: payload.email_verified === true };
  } catch {
    return null;
  }
}

/** ALLOWED_EMAILS=a@x.com,b@y.com keeps the site to a guest list. Empty lets anyone signed in use it. */
export function onGuestList(v: Visitor) {
  const list = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !list.length || (!!v.email && v.verified && list.includes(v.email));
}
