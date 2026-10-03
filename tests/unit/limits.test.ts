import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY, overDailyLimit } from '../../server/limits';

// Daily allowances are counted in Supabase; these checks stand in for it.
const SUPABASE = 'https://example.supabase.co';
const counted = (n: number) => vi.fn(async () => new Response(String(n), { status: 200 }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('daily limits', () => {
  it('are off when the site has no sign-in (running on your own computer)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_URL', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await overDailyLimit('ticket', 'dig')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('let people through up to the limit, then explain plainly', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
    vi.stubGlobal('fetch', counted(DAILY.dig));
    expect(await overDailyLimit('ticket', 'dig')).toBeNull();
    vi.stubGlobal('fetch', counted(DAILY.dig + 1));
    expect(await overDailyLimit('ticket', 'dig')).toMatch(new RegExp(`today's ${DAILY.dig} digs`));
    vi.stubGlobal('fetch', counted(DAILY.chat + 1));
    expect(await overDailyLimit('ticket', 'chat')).toMatch(/messages to the partner/);
  });

  it('count as the visitor (their own ticket), on the right counter', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
    const fetch = counted(1);
    vi.stubGlobal('fetch', fetch);
    await overDailyLimit('their-ticket', 'chat');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SUPABASE}/rest/v1/rpc/take_hit`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer their-ticket');
    expect(JSON.parse(String(init.body))).toEqual({ bucket: 'chat' });
  });

  it("let people through if Supabase can't be reached", async () => {
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await overDailyLimit('ticket', 'dig')).toBeNull();
  });
});
