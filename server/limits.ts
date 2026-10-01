import { authProject } from './auth';

// Daily limits per account, counted in Supabase (supabase/safety.sql) so they hold across
// every server copy Vercel starts. They keep one person or a bot from using up the free
// AI allowance everyone shares. Counting is done as the visitor (their own ticket), so no
// secret key is needed. If Supabase can't be reached, requests go through: a hiccup
// there shouldn't stop anyone researching.

const anonKey = () => (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim();

export const DAILY: Record<'dig' | 'chat', number> = {
  dig: Number(process.env.DAILY_DIGS) || 60,
  chat: Number(process.env.DAILY_CHATS) || 250,
};

let warned = false;

async function rpc(token: string, fn: string, body: unknown) {
  const res = await fetch(`${authProject()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

/** Counts one use for this visitor today. Returns a message when they're over the limit. */
export async function overDailyLimit(token: string | undefined, bucket: keyof typeof DAILY): Promise<string | null> {
  if (!authProject() || !token) return null;
  try {
    const used = Number(await rpc(token, 'take_hit', { bucket }));
    if (used <= DAILY[bucket]) return null;
    return bucket === 'dig'
      ? `That's today's ${DAILY.dig} digs used up. Your boards are all still here; digging opens again tomorrow (midnight UTC).`
      : `That's today's ${DAILY.chat} messages to the partner used up. It opens again tomorrow (midnight UTC).`;
  } catch (e) {
    if (!warned) console.warn(`[limits] daily limits are off: ${e instanceof Error ? e.message : e}. Run supabase/safety.sql to switch them on.`);
    warned = true;
    return null;
  }
}

/** Puts a server error in the owner's error log (admin.errors), as the visitor it happened to. */
export function logServerError(token: string | undefined, where: string, err: unknown) {
  if (!authProject() || !token) return;
  const message = err instanceof Error ? err.message : String(err);
  const detail = err instanceof Error ? err.stack?.split('\n').slice(0, 8).join('\n') : undefined;
  rpc(token, 'log_error', { place: 'server', message, detail, page: where, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local' }).catch(() => undefined);
}
