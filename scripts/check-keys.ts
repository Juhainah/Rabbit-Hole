// Tests every key in .env with a real (tiny) request and shows what's left of its free limits:
//   npm run check:keys
// Key values are never printed; anything a service echoes back is scrubbed too.
import 'dotenv/config';
import { describeLimits, resolveProviders, testProvider } from '../server/llm';
import { PROVIDER_PRESETS } from '../server/providers';

const env = (k: string) => process.env[k]?.trim() ?? '';
const SECRETS = Object.entries(process.env)
  .filter(([k, v]) => /KEY|TOKEN|SECRET|ACCOUNT_ID/.test(k) && (v?.trim().length ?? 0) >= 8)
  .map(([, v]) => v!.trim());
const scrub = (s: string) => SECRETS.reduce((out, secret) => out.split(secret).join('[hidden]'), s);

// ok: working · busy: fine but rate-limited right now · false: broken
type Result = { ok: boolean | 'busy'; detail: string };
const rows: { group: string; name: string; result: Result | null; hint?: string }[] = [];

async function check(group: string, name: string, needs: string[], run: () => Promise<Result>, hint?: string) {
  // Take a place in the report now, so parallel checks still print in order.
  const row: (typeof rows)[number] = { group, name, result: null, hint };
  rows.push(row);
  if (needs.some((k) => !env(k))) return;
  try {
    row.result = await run();
  } catch (e) {
    row.result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const why = body?.error?.message ?? body?.message ?? body?.detail ?? body?.error ?? text.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`HTTP ${res.status}: ${typeof why === 'string' ? why.slice(0, 140) : res.statusText}`);
  }
  return { body, headers: res.headers };
}

const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '?'));
const when = (unixSeconds: number) => {
  const mins = Math.max(0, Math.round((unixSeconds * 1000 - Date.now()) / 60000));
  return mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`;
};

// ── AI brains: a one-word test reply from each, plus the limits they report ──
const chain = resolveProviders();
await Promise.all(
  chain.map((p) =>
    check('AI brains', p.name, [], async () => {
      const r = await testProvider(p);
      const limits = describeLimits(r.limits, p.id);
      if (r.ok) return { ok: true, detail: [`answers in ${(r.ms / 1000).toFixed(1)}s`, limits].filter(Boolean).join(' · ') };
      // 429 means the key works but the free model is busy; the app just moves to the next brain.
      if (/HTTP 429/.test(r.error ?? '')) return { ok: 'busy', detail: 'busy right now (free model rate-limited). Key is fine; the app skips to the next brain.' };
      return { ok: false, detail: r.error ?? 'failed' };
    }),
  ),
);
for (const p of PROVIDER_PRESETS.filter((p) => !p.keyless && !chain.some((c) => c.id === p.id)))
  rows.push({ group: 'AI brains', name: p.name, result: null, hint: p.keyUrl });

// Account-level details some AI services publish.
await check('AI accounts', 'OpenRouter account', ['OPENROUTER_API_KEY'], async () => {
  const { body } = await fetchJson('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${env('OPENROUTER_API_KEY')}` } });
  const d = body?.data ?? {};
  const spent = typeof d.usage === 'number' ? `$${d.usage.toFixed(2)} spent` : '';
  const tier = d.is_free_tier === true ? 'free tier (no credits bought)' : d.is_free_tier === false ? 'has bought credits' : '';
  // Only ":free" models are ever used, so spending should always stay at $0.
  return { ok: !(typeof d.usage === 'number' && d.usage > 0), detail: [tier, spent, d.limit == null ? 'no spending limit set' : `limit $${d.limit}`].filter(Boolean).join(' · ') };
});
await check('AI accounts', 'Hugging Face account', ['HF_TOKEN'], async () => {
  const { body } = await fetchJson('https://huggingface.co/api/whoami-v2', { headers: { Authorization: `Bearer ${env('HF_TOKEN')}` } });
  return { ok: true, detail: `signed in as ${body?.name ?? '?'} · token type: ${body?.auth?.accessToken?.role ?? '?'} · small free monthly credit (402 errors = used up until next month)` };
});
await check('AI accounts', 'Cloudflare token', ['CLOUDFLARE_API_TOKEN'], async () => {
  const { body } = await fetchJson('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${env('CLOUDFLARE_API_TOKEN')}` } });
  const r = body?.result ?? {};
  return { ok: r.status === 'active', detail: `${r.status ?? '?'}${r.expires_on ? ` · expires ${String(r.expires_on).slice(0, 10)}` : ' · never expires'} · free: 10,000 neurons a day` };
});

// ── Web search ──
await check('Web search', 'Tavily', ['TAVILY_API_KEY'], async () => {
  try {
    const { body } = await fetchJson('https://api.tavily.com/usage', { headers: { Authorization: `Bearer ${env('TAVILY_API_KEY')}` } });
    const used = body?.account?.plan_usage ?? body?.key?.usage;
    const limit = body?.account?.plan_limit ?? body?.key?.limit;
    if (used != null && limit != null) return { ok: true, detail: `${num(limit - used)} of ${num(limit)} searches left this month (${body?.account?.current_plan ?? 'free'} plan)` };
  } catch {
    /* older accounts: fall back to a one-credit search */
  }
  const { body } = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('TAVILY_API_KEY')}` },
    body: JSON.stringify({ query: 'Tunguska event', max_results: 1 }),
  });
  return { ok: Array.isArray(body?.results), detail: 'search works · free: 1,000 searches a month' };
}, 'https://app.tavily.com');
await check('Web search', 'Serper', ['SERPER_API_KEY'], async () => {
  const { body } = await fetchJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') },
    body: JSON.stringify({ q: 'Tunguska event', num: 1 }),
  });
  return { ok: !!body?.organic, detail: `search works${body?.credits != null ? ` · used ${body.credits} credit` : ''} · free: 2,500 searches once` };
}, 'https://serper.dev');
await check('Web search', 'Reserp', ['RESERP_API_KEY'], async () => {
  const { body } = await fetchJson('https://api.reserp.ai/v2/serp/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('RESERP_API_KEY')}` },
    body: JSON.stringify({ url: 'https://www.google.com/search?q=Tunguska+event&gl=us&hl=en' }),
  });
  return { ok: body?.ok === true && Array.isArray(body?.results), detail: body?.ok ? `Google search works · ${body.results.length} results · free: 5,000 a month` : `refused: ${JSON.stringify(body?.error ?? body).slice(0, 80)}` };
}, 'https://reserp.ai/dashboard/keys');
await check('Web search', 'LangSearch', ['LANGSEARCH_API_KEY'], async () => {
  const { body } = await fetchJson('https://api.langsearch.com/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env('LANGSEARCH_API_KEY')}` },
    body: JSON.stringify({ query: 'Tunguska event', count: 1 }),
  });
  return { ok: Array.isArray(body?.data?.webPages?.value), detail: 'search works · free: a daily allowance, no card' };
}, 'https://langsearch.com');
await check('Web search', 'Exa', ['EXA_API_KEY'], async () => {
  const { body } = await fetchJson('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env('EXA_API_KEY') },
    body: JSON.stringify({ query: 'Tunguska event', numResults: 1 }),
  });
  return { ok: Array.isArray(body?.results), detail: 'search works · free: $10 of searches every month' };
}, 'https://dashboard.exa.ai');
await check('Web search', 'SerpApi', ['SERPAPI_API_KEY'], async () => {
  const { body } = await fetchJson(`https://serpapi.com/account.json?api_key=${encodeURIComponent(env('SERPAPI_API_KEY'))}`);
  const left = body?.total_searches_left ?? body?.plan_searches_left;
  return { ok: left != null, detail: left != null ? `${num(left)} searches left this month · free: 250 a month` : 'key refused' };
}, 'https://serpapi.com/users/sign_up');

// ── Research sources that take a key ──
await check('Sources', 'GitHub', ['GITHUB_TOKEN'], async () => {
  const { body, headers } = await fetchJson('https://api.github.com/rate_limit', {
    headers: { Authorization: `Bearer ${env('GITHUB_TOKEN')}`, Accept: 'application/vnd.github+json' },
  });
  const core = body?.resources?.core;
  const search = body?.resources?.search;
  const expires = headers.get('github-authentication-token-expiration');
  return {
    ok: (core?.limit ?? 0) > 60,
    detail: [
      `API ${num(core?.remaining)}/${num(core?.limit)} left (resets in ${when(core?.reset ?? 0)})`,
      `search ${num(search?.remaining)}/${num(search?.limit)} a minute`,
      expires ? `token expires ${expires.slice(0, 10)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}, 'https://github.com/settings/personal-access-tokens');
await check('Sources', 'CourtListener', ['COURTLISTENER_TOKEN'], async () => {
  const { body } = await fetchJson('https://www.courtlistener.com/api/rest/v4/search/?q=Roswell&type=o', {
    headers: { Authorization: `Token ${env('COURTLISTENER_TOKEN')}`, 'User-Agent': 'RabbitHole/0.2 key check' },
  });
  return { ok: Array.isArray(body?.results), detail: `search works (${num(body?.count)} results) · free: 5,000 requests an hour` };
}, 'https://www.courtlistener.com/sign-in/');
await check('Sources', 'YouTube', ['YOUTUBE_API_KEY'], async () => {
  await fetchJson(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${env('YOUTUBE_API_KEY')}`);
  return { ok: true, detail: 'works · free: 10,000 units a day (a search costs 100)' };
}, 'https://console.cloud.google.com/apis/library/youtube.googleapis.com');
await check('Sources', 'Reddit', ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], async () => {
  const basic = Buffer.from(`${env('REDDIT_CLIENT_ID')}:${env('REDDIT_CLIENT_SECRET')}`).toString('base64');
  const { body } = await fetchJson('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'RabbitHole/0.2 key check' },
    body: 'grant_type=client_credentials',
  });
  return { ok: !!body?.access_token, detail: 'app login works · free: 100 requests a minute' };
}, 'https://www.reddit.com/prefs/apps');
// The app uses the data.gov key for the Smithsonian's open collection.
await check('Sources', 'data.gov (Smithsonian)', ['DATA_GOV_API_KEY'], async () => {
  const { body, headers } = await fetchJson(`https://api.si.edu/openaccess/api/v1.0/search?q=Tunguska&rows=1&api_key=${env('DATA_GOV_API_KEY')}`);
  const left = headers.get('x-ratelimit-remaining');
  const limit = headers.get('x-ratelimit-limit');
  return { ok: true, detail: [`search works (${num(body?.response?.rowCount)} results)`, left && limit ? `${num(Number(left))}/${num(Number(limit))} requests left this hour` : ''].filter(Boolean).join(' · ') };
}, 'https://api.data.gov/signup/');
await check('Sources', 'Europeana', ['EUROPEANA_API_KEY'], async () => {
  const { body } = await fetchJson(`https://api.europeana.eu/record/v2/search.json?query=Tunguska&rows=1&wskey=${env('EUROPEANA_API_KEY')}`);
  return { ok: body?.success !== false, detail: `search works (${num(body?.totalResults)} results)` };
}, 'https://pro.europeana.eu/pages/get-api');
await check('Sources', 'Semantic Scholar', ['S2_API_KEY'], async () => {
  await fetchJson('https://api.semanticscholar.org/graph/v1/paper/search?query=Tunguska&limit=1', { headers: { 'x-api-key': env('S2_API_KEY') } });
  return { ok: true, detail: 'search works · 1 request a second' };
}, 'https://www.semanticscholar.org/product/api');
await check('Sources', 'OCCRP Aleph', ['ALEPH_API_KEY'], async () => {
  await fetchJson('https://aleph.occrp.org/api/2/search?q=Tunguska&limit=1', { headers: { Authorization: `ApiKey ${env('ALEPH_API_KEY')}` } });
  return { ok: true, detail: 'search works' };
}, 'https://aleph.occrp.org');

// ── Settings ──
await check('Settings', 'CONTACT_EMAIL', ['CONTACT_EMAIL'], async () => {
  const good = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env('CONTACT_EMAIL'));
  return { ok: good, detail: good ? 'set · Wikipedia and OpenStreetMap see who to contact' : "doesn't look like an email address" };
});
await check('Settings', 'Supabase sign-in', ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], async () => {
  const { body } = await fetchJson(`${env('VITE_SUPABASE_URL').replace(/\/+$/, '')}/auth/v1/settings`, { headers: { apikey: env('VITE_SUPABASE_ANON_KEY') } });
  const on = Object.entries(body?.external ?? {}).filter(([k, v]) => v === true && k !== 'phone').map(([k]) => k);
  const wanted = (env('VITE_AUTH_PROVIDERS') || 'github').split(',').map((s) => s.trim()).filter(Boolean);
  const missing = wanted.filter((p) => !on.includes(p));
  return { ok: !missing.length, detail: missing.length ? `switch on ${missing.join(' and ')} in Supabase → Authentication → Sign In / Providers` : `project reachable · sign-in with: ${on.join(', ') || 'none yet'}` };
}, 'not set up yet (only needed for the online version)');

// ── Report ──
let group = '';
let failed = 0;
for (const r of rows) {
  if (r.group !== group) {
    group = r.group;
    console.log(`\n${group.toUpperCase()}`);
  }
  const mark = r.result ? (r.result.ok === 'busy' ? '⚠️ ' : r.result.ok ? '✅' : '❌') : '⚪';
  if (r.result && !r.result.ok) failed++;
  const detail = r.result ? r.result.detail : `not set${r.hint ? `  →  ${r.hint}` : ''}`;
  console.log(`  ${mark} ${r.name.padEnd(28)} ${scrub(detail)}`);
}
const set = rows.filter((r) => r.result).length;
console.log(`\n${set - failed} of ${set} configured keys working${failed ? `, ${failed} need attention` : ''}. ⚠️  = busy for now · ⚪ = optional, not set.\n`);
process.exit(failed ? 1 : 0);
