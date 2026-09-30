import { execFile } from 'node:child_process';

// Polite APIs (OpenStreetMap, OpenAlex, SEC) want to know who is calling.
// Placeholder emails get blocked, so the contact is only added when set.
export const CONTACT = process.env.CONTACT_EMAIL?.trim() || '';
// Wikimedia's policy: "<client>/<version> (<contact>) <library>". Without contact
// info they throttle hard, so CONTACT_EMAIL in .env really matters.
export const UA = `RabbitHole/0.2 (${CONTACT ? `mailto:${CONTACT}` : 'self-hosted research app'}) node/${process.versions.node}`;

// Wikimedia asks for gentle, mostly serial access. Cap concurrency per host family.
const HOST_LIMITS: [RegExp, number][] = [
  [/(^|\.)wikipedia\.org$|(^|\.)wikimedia\.org$|(^|\.)wikidata\.org$|(^|\.)wikiquote\.org$|(^|\.)wikisource\.org$|(^|\.)wiktionary\.org$/, 3],
];
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();
async function acquire(host: string): Promise<() => void> {
  const rule = HOST_LIMITS.find(([re]) => re.test(host));
  if (!rule) return () => undefined;
  const key = rule[0].source;
  if ((active.get(key) ?? 0) >= rule[1]) {
    await new Promise<void>((resolve) => waiting.set(key, [...(waiting.get(key) ?? []), resolve]));
  }
  active.set(key, (active.get(key) ?? 0) + 1);
  return () => {
    active.set(key, (active.get(key) ?? 1) - 1);
    const next = waiting.get(key)?.shift();
    next?.();
  };
}
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export interface FetchOpts {
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  body?: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body = '',
  ) {
    super(message);
  }
}

// Some sites (Cloudflare/Akamai bot walls) reject Node's TLS fingerprint but
// happily answer curl, which ships with Windows, macOS and Linux. Hosts that
// needed it are remembered so later calls go straight to curl.
const curlHosts = new Set<string>();

function curl(url: string, opts: FetchOpts): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Accept: 'application/json, */*;q=0.8', ...opts.headers };
    const args = ['-s', '-L', '--compressed', '-m', String(Math.ceil((opts.timeout ?? 15000) / 1000))];
    args.push('-A', headers['User-Agent'] ?? BROWSER_UA, '-w', '\n__STATUS__%{http_code}');
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'user-agent') args.push('-H', `${k}: ${v}`);
    if (opts.method && opts.method !== 'GET') args.push('-X', opts.method);
    if (opts.body) args.push('--data-raw', opts.body);
    args.push(url);
    const child = execFile('curl', args, { maxBuffer: 30 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      const i = stdout?.lastIndexOf('\n__STATUS__') ?? -1;
      if (i < 0) return reject(err ?? new Error('curl failed'));
      resolve({ status: parseInt(stdout.slice(i + 11), 10) || 0, body: stdout.slice(0, i) });
    });
    opts.signal?.addEventListener('abort', () => child.kill(), { once: true });
  });
}

async function viaCurl(url: string, opts: FetchOpts, host: string): Promise<Response> {
  const r = await curl(url, { ...opts, headers: { 'User-Agent': BROWSER_UA, ...opts.headers } });
  if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, `HTTP ${r.status} from ${host}`, r.body.slice(0, 500));
  curlHosts.add(host);
  return new Response(r.body, { status: 200 });
}

export async function http(url: string, opts: FetchOpts = {}, attempt = 0): Promise<Response> {
  const host = new URL(url).hostname;
  if (curlHosts.has(host)) return viaCurl(url, opts, host);
  const release = await acquire(host);
  let res: Response;
  try {
    const signals = [AbortSignal.timeout(opts.timeout ?? 15000)];
    if (opts.signal) signals.push(opts.signal);
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json, */*;q=0.8', ...opts.headers },
      signal: AbortSignal.any(signals),
      redirect: 'follow',
    });
  } finally {
    release();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const botWall = res.status === 403 && /<html|<!doctype/i.test(body);
    if (botWall && !opts.signal?.aborted) return viaCurl(url, opts, host);
    // Rate limited: wait as asked (briefly) and try again, twice at most.
    if (res.status === 429 && attempt < 2 && !opts.signal?.aborted) {
      const after = Math.min(6, Number(res.headers.get('retry-after')) || 1.5 * (attempt + 1));
      await sleep(after * 1000);
      return http(url, opts, attempt + 1);
    }
    throw new HttpError(res.status, `HTTP ${res.status} from ${host}`, body.slice(0, 500));
  }
  return res;
}

export async function getJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const res = await http(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).hostname}`);
  }
}

export async function getText(url: string, opts: FetchOpts = {}): Promise<string> {
  const res = await http(url, opts);
  return res.text();
}

export const enc = encodeURIComponent;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripHtml(s: string | undefined | null, max = 400): string {
  if (!s) return '';
  const text = decodeEntities(
    String(s)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialises calls per host so polite APIs (Nominatim, GDELT, MusicBrainz) aren't hammered. */
export function throttle(minGapMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError') return 'timed out';
    return e.message;
  }
  return String(e);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Sources format dates every way imaginable ("Taken on 14 September 2001",
 * "c. 1890", "2001:09:14 10:22:01", "Sept. 3rd, 1967"). Normalise to
 * YYYY, YYYY-MM or YYYY-MM-DD when possible, otherwise a short trimmed string.
 */
export function normalizeDate(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = stripHtml(String(raw), 120)
    .replace(/^(taken|published|created|uploaded|dated?|on|circa|ca\.?|c\.)\s+(on\s+)?/i, '')
    .trim();
  if (!s) return undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  let m = s.match(/^(-?\d{3,4})[-:/.](\d{1,2})(?:[-:/.](\d{1,2}))?/);
  if (m) return m[3] ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : `${m[1]}-${pad(+m[2])}`;
  const monthIdx = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{3,4})/);
  if (m && monthIdx(m[2]) >= 0) return `${m[3]}-${pad(monthIdx(m[2]) + 1)}-${pad(+m[1])}`;
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{3,4})/);
  if (m && monthIdx(m[1]) >= 0) return `${m[3]}-${pad(monthIdx(m[1]) + 1)}-${pad(+m[2])}`;
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (m && monthIdx(m[1]) >= 0) return `${m[2]}-${pad(monthIdx(m[1]) + 1)}`;
  m = s.match(/\b(\d{3,4})\s*(BCE?|AD|CE)?\b/i);
  if (m) return /BC/i.test(m[2] ?? '') ? `-${m[1]}` : m[1];
  return s.length > 18 ? undefined : s;
}
