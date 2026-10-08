import type { SourceItem } from '../../shared/types';
import { parseHtml } from '../dom';
import { BROWSER_UA, enc, getJson, getText, stripHtml, throttle } from '../http';
import { host, type SearchFn } from './types';

const HTML_HEADERS = { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' };
const braveQueue = throttle(2500);
const ddgQueue = throttle(3000);

const FORUM_SITES: Record<string, string> = { 'quora.com': 'Quora', 'abovetopsecret.com': 'AboveTopSecret', 'unexplained-mysteries.com': 'Unexplained Mysteries', 'godlikeproductions.com': 'Godlike Productions', 'archive.4plebs.org': '4chan /x/', 'metafilter.com': 'MetaFilter', 'stackexchange.com': 'Stack Exchange', 'tildes.net': 'Tildes', 'city-data.com': 'City-Data', 'forums.somethingawful.com': 'Something Awful' };

function toItem(url: string, title: string, snippet: string, source = 'web'): SourceItem {
  const h = host(url);
  // A Reddit thread or forum post found by web search is a discussion, and is shown as one.
  const thread = url.match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
  if (thread) {
    return {
      id: `reddit:${thread[2]}`,
      source: 'reddit',
      kind: 'post',
      title: title.replace(/\s*:\s*r\/\w+\s*$/i, '').replace(/\s*[-|]\s*Reddit\s*$/i, '').trim() || 'Reddit thread',
      snippet: snippet.replace(/\s+/g, ' ').trim(),
      url,
      meta: { sub: `r/${thread[1]}` },
    };
  }
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
  if (yt) {
    return {
      id: `youtube:${yt}`,
      source: 'youtube',
      kind: 'video',
      title: title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'YouTube video',
      snippet: snippet.replace(/\s+/g, ' ').trim(),
      url: `https://www.youtube.com/watch?v=${yt}`,
      image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      media: { type: 'youtube', src: yt },
    };
  }
  const forum = h && Object.entries(FORUM_SITES).find(([site]) => h === site || h.endsWith(`.${site}`));
  if (forum) {
    return { id: `forums:${url}`, source: 'forums', kind: 'post', title: title.replace(/\s*[-|]\s*Quora\s*$/i, '').trim() || h!, snippet: snippet.replace(/\s+/g, ' ').trim(), url, meta: { sub: forum[1] } };
  }
  return {
    id: `${source}:${url}`,
    source,
    kind: 'article',
    title: title.trim() || h || url,
    snippet: snippet.replace(/\s+/g, ' ').trim(),
    url,
    meta: h ? { site: h } : undefined,
  };
}

async function brave(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const html = await braveQueue(() =>
    getText(`https://search.brave.com/search?q=${enc(q)}&source=web`, { signal, timeout: 12000, headers: HTML_HEADERS }),
  );
  const doc = await parseHtml(html);
  const out: SourceItem[] = [];
  for (const r of doc.querySelectorAll('.snippet[data-type="web"]')) {
    const a = r.querySelector<HTMLAnchorElement>('a[href^="http"]');
    const href = a?.getAttribute('href');
    if (!href || href.includes('search.brave.com')) continue;
    const title = r.querySelector('.search-snippet-title, .title')?.textContent ?? a?.textContent ?? '';
    const snippet = r.querySelector('.generic-snippet .content, .snippet-description')?.textContent ?? '';
    out.push(toItem(href, title, snippet));
    if (out.length >= limit) break;
  }
  if (!out.length && /captcha|are you a robot/i.test(html)) throw new Error('Brave asked for a captcha');
  return out;
}

async function duckduckgo(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const html = await ddgQueue(() =>
    getText(`https://html.duckduckgo.com/html/?q=${enc(q)}&kl=us-en`, { signal, timeout: 12000, headers: HTML_HEADERS }),
  );
  const doc = await parseHtml(html);
  if (doc.querySelector('.anomaly-modal, #challenge-form')) throw new Error('DuckDuckGo asked for a captcha');
  const out: SourceItem[] = [];
  for (const r of doc.querySelectorAll('.result')) {
    if (r.classList.contains('result--ad')) continue;
    const a = r.querySelector<HTMLAnchorElement>('a.result__a');
    if (!a) continue;
    let href = a.getAttribute('href') ?? '';
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    if (!/^https?:/.test(href) || /duckduckgo\.com\/y\.js|bing\.com\/aclick/.test(href)) continue;
    out.push(toItem(href, a.textContent ?? '', r.querySelector('.result__snippet')?.textContent ?? ''));
    if (out.length >= limit) break;
  }
  return out;
}

/** Tavily: free 1,000 searches/month, no card. Built for AI research. */
async function tavily(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson('https://api.tavily.com/search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, max_results: limit, search_depth: 'basic' }),
  });
  return (j.results ?? []).map((r: any) => toItem(r.url, r.title ?? '', stripHtml(r.content, 400)));
}

/** LangSearch: a free web search (daily allowance, no card), with publication dates. Off until LANGSEARCH_API_KEY is set. */
async function langsearch(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.LANGSEARCH_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson('https://api.langsearch.com/v1/web-search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, count: Math.min(limit, 20), freshness: 'noLimit', summary: true }),
  });
  if (j?.code && j.code !== 200) throw new Error(`LangSearch ${j.code}: ${j.msg ?? 'refused'}`);
  return (j?.data?.webPages?.value ?? []).map((r: any) => {
    const it = toItem(r.url, r.name ?? '', stripHtml(r.summary || r.snippet || '', 400));
    const d = r.datePublished ? new Date(r.datePublished) : null;
    if (d && !Number.isNaN(d.getTime())) it.date = d.toISOString().slice(0, 10);
    return it;
  });
}

/** Exa: $10 of free searches every month, no payment method. Off until EXA_API_KEY is set. */
async function exa(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson('https://api.exa.ai/search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    // Exa takes "site:" as a list of domains to search, not as words in the query.
    body: JSON.stringify({
      query: q.replace(/\s*\bsite:[\w.-]+/gi, '').replace(/\s*\bOR\b\s*/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
      numResults: Math.min(limit, 10),
      type: 'auto',
      contents: { text: { maxCharacters: 600 } },
      ...((): { includeDomains?: string[] } => {
        const d = [...q.matchAll(/\bsite:([\w.-]+\.[a-z]{2,})/gi)].map((m) => m[1].replace(/^www\./, ''));
        return d.length ? { includeDomains: d } : {};
      })(),
    }),
  });
  return (j?.results ?? []).map((r: any) => {
    const it = toItem(r.url, r.title ?? '', stripHtml(r.text ?? '', 400));
    if (r.publishedDate) it.date = String(r.publishedDate).slice(0, 10);
    if (r.author && !it.author) it.author = String(r.author).slice(0, 60);
    return it;
  });
}

/** Firecrawl search: 1,000 free credits a month, no card. Off until FIRECRAWL_API_KEY is set. */
async function firecrawl(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, limit: Math.min(limit, 10) }),
  });
  if (j?.success === false) throw new Error(`Firecrawl: ${j.error ?? 'refused'}`);
  return (j?.data ?? []).filter((r: any) => r?.url).map((r: any) => toItem(r.url, r.title ?? '', stripHtml(r.description ?? '', 400)));
}

/** SerpApi (Google results): 250 free searches a month, no card. Off until SERPAPI_API_KEY is set. */
async function serpapi(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson(`https://serpapi.com/search.json?engine=google&q=${enc(q)}&num=${Math.min(limit, 20)}&api_key=${enc(key)}`, { signal });
  if (j?.error) throw new Error(`SerpApi: ${j.error}`);
  return (j?.organic_results ?? []).map((r: any) => {
    const it = toItem(r.link, r.title ?? '', r.snippet ?? '');
    const d = r.date ? new Date(r.date) : null;
    if (d && !Number.isNaN(d.getTime()) && /\d{4}/.test(r.date)) it.date = d.toISOString().slice(0, 10);
    return it;
  });
}

/** Serper (Google results): 2,500 free searches, no card. */
export async function serper(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson('https://google.serper.dev/search', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q, num: limit }),
  });
  return (j.organic ?? []).map((r: any) => {
    const it = toItem(r.link, r.title ?? '', r.snippet ?? '');
    const d = r.date ? new Date(r.date) : null;
    // "Jun 27, 2014" is a date; "3 days ago" is not worth guessing.
    if (d && !Number.isNaN(d.getTime()) && /\d{4}/.test(r.date)) it.date = d.toISOString().slice(0, 10);
    return it;
  });
}

/**
 * Google's own results, for the few searches that matter most (reading the search, the two key searches):
 * Serper while it has credits, then SerpApi. Empty when neither works, so callers fall back to webSearch.
 */
export async function googleSearch(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  for (const engine of [serper, serpapi]) {
    if ((engineRest.get(engine.name) ?? 0) > Date.now()) continue;
    try {
      const items = await engine(q, limit, signal);
      if (items.length) return items;
    } catch (e) {
      if (signal?.aborted) throw e;
      const m = e instanceof Error ? e.message : String(e);
      if (/\b(400|432|401|402|403)\b|usage limit|quota|credits/i.test(m)) engineRest.set(engine.name, Date.now() + 6 * 3600_000);
      else if (/\b429\b/.test(m)) engineRest.set(engine.name, Date.now() + 2 * 60_000);
    }
  }
  return [];
}

/** Google Images through Serper: real pictures of the thing asked about, with the page each came from. */
export async function serperImages(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return [];
  const j = await getJson<any>('https://google.serper.dev/images', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q, num: Math.min(limit * 2, 20) }),
  });
  return (j.images ?? [])
    .filter((r: any) => r.imageUrl && /^https:/.test(r.imageUrl) && !/\.(svg|gif)(\?|$)/i.test(r.imageUrl) && (r.imageWidth ?? 400) >= 240)
    .slice(0, limit)
    .map((r: any) => ({
      id: `web:img:${r.imageUrl}`,
      source: 'web',
      kind: 'image' as const,
      title: String(r.title ?? '').slice(0, 160),
      snippet: r.source ? `Picture from ${r.source}` : undefined,
      url: r.link ?? r.imageUrl,
      image: r.imageUrl,
      meta: r.source ? { site: String(r.source) } : undefined,
    }));
}

const webCache = new Map<string, { at: number; items: SourceItem[] }>();
/** Engines resting after a limit or refusal, until this time. */
const engineRest = new Map<string, number>();

/**
 * Web search chain: optional free-key engines first (Tavily, Serper), then
 * keyless scraping (Brave honours site:, DuckDuckGo as last resort).
 */
export async function webSearch(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const key = `${q}|${limit}`;
  const hit = webCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.items;
  const errors: string[] = [];
  // "… site:reddit.com": only pages from there count. An engine that ignores the operator (LangSearch)
  // returns the open web instead; then the next engine is asked.
  const sites = [...q.matchAll(/\bsite:([\w.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, ''));
  const onSite = (it: SourceItem) => !sites.length || sites.some((s) => (host(it.url) ?? '').endsWith(s));
  // Best results first: Tavily, Exa and Google (SerpApi) renew every month; LangSearch (daily, but its own
  // weaker index) after them; Serper's one-time searches and the keyless scrapers last.
  // A strong engine's answer is enough. A weak one (its own small index, or a scraped page) is combined
  // with the next engine that works, so a niche topic gets two chances to turn up its pages.
  const strong = new Set<SearchEngine>([tavily, exa, serpapi, firecrawl, serper]);
  let got: SourceItem[] = [];
  let weakAnswers = 0;
  for (const engine of [tavily, exa, serpapi, firecrawl, langsearch, serper, brave, duckduckgo] as SearchEngine[]) {
    if ((engineRest.get(engine.name) ?? 0) > Date.now()) continue;
    try {
      const items = (await engine(q, limit, signal)).filter(onSite);
      if (items.length) {
        got = interleave(got, items);
        if (strong.has(engine) || ++weakAnswers >= 2) break;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      const m = e instanceof Error ? e.message : String(e);
      errors.push(m);
      // Out of its monthly allowance or key refused: skip it for six hours instead of asking every time.
      if (/\b(432|401|402|403)\b|usage limit|quota|credits/i.test(m)) engineRest.set(engine.name, Date.now() + 6 * 3600_000);
      else if (/\b429\b/.test(m)) engineRest.set(engine.name, Date.now() + 2 * 60_000);
    }
  }
  if (got.length) {
    webCache.set(key, { at: Date.now(), items: got });
    return got;
  }
  if (errors.length) throw new Error(errors.join('; '));
  return [];
}

type SearchEngine = (q: string, limit: number, signal?: AbortSignal) => Promise<SourceItem[]>;

/** Two engines' answers, best of each first, each page once. */
function interleave(a: SourceItem[], b: SourceItem[]): SourceItem[] {
  if (!a.length) return b;
  const out: SourceItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const it of [a[i], b[i]]) {
      const k = it?.url?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') ?? it?.id;
      if (it && k && !seen.has(k)) {
        seen.add(k);
        out.push(it);
      }
    }
  }
  return out;
}

export const web: SearchFn = (q, { limit, signal }) => webSearch(q, limit, signal);

export const wiby: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson<any[]>(`https://wiby.me/json/?q=${enc(q)}`, { signal });
  return j.slice(0, limit).map((r) => toItem(r.URL, stripHtml(r.Title), stripHtml(r.Snippet, 300), 'wiby'));
};

export const github: SearchFn = async (q, { limit, signal }) => {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const j = await getJson(`https://api.github.com/search/repositories?q=${enc(q)}&per_page=${limit}&sort=stars`, {
    signal,
    headers,
  });
  return (j.items ?? []).map((r: any) => ({
    id: `github:${r.id}`,
    source: 'github',
    kind: 'code' as const,
    title: r.full_name,
    snippet: r.description ?? '',
    url: r.html_url,
    image: r.owner?.avatar_url,
    date: r.pushed_at?.slice(0, 10),
    meta: { stars: r.stargazers_count ?? 0, ...(r.language ? { lang: r.language } : {}) },
  }));
};

// ── Niche corners of the internet ────────────────────────────────────────────

/** Atlas Obscura's own search, plus each place's coordinates and photo. */
export const atlasobscura: SearchFn = async (q, { limit, signal }) => {
  const hits = await getJson<{ id: number; title: string; slug: string }[]>(
    `https://www.atlasobscura.com/search/places?q=${enc(q)}&format=json`,
    { signal, headers: { 'User-Agent': BROWSER_UA } },
  );
  const details = await Promise.allSettled(
    hits.slice(0, limit).map((h) =>
      getJson(`https://www.atlasobscura.com/places/${h.slug}.json`, { signal, headers: { 'User-Agent': BROWSER_UA } }),
    ),
  );
  return hits.slice(0, limit).map((h, i) => {
    const d: any = details[i].status === 'fulfilled' ? (details[i] as PromiseFulfilledResult<any>).value : {};
    return {
      id: `atlasobscura:${h.id}`,
      source: 'atlasobscura',
      kind: 'place' as const,
      title: h.title,
      snippet: [d.subtitle, d.location].filter(Boolean).join(' — '),
      url: d.url ?? `https://www.atlasobscura.com/places/${h.slug}`,
      image: d.thumbnail_url_3x2 ?? d.thumbnail_url,
      lat: d.coordinates?.lat,
      lon: d.coordinates?.lng,
      meta: d.physical_status && d.physical_status !== 'active' ? { status: d.physical_status } : undefined,
    };
  });
};

/** Finds the fandom wikis that match, then searches inside the top two. */
export const fandom: SearchFn = async (q, { limit, signal }) => {
  const s = await getJson(
    `https://services.fandom.com/unified-search/community-search?query=${enc(q)}&lang=en&limit=3`,
    { signal, headers: { 'User-Agent': BROWSER_UA } },
  );
  const wikis: { name: string; url: string }[] = (s.results ?? [])
    .slice(0, 2)
    .map((w: any) => ({ name: w.name, url: String(w.url).replace(/\/$/, '') }));
  const per = Math.ceil(limit / Math.max(1, wikis.length));
  const batches = await Promise.allSettled(
    wikis.map(async (w) => {
      const base = w.url.startsWith('http') ? w.url : `https://${w.url}`;
      const j = await getJson(
        `${base}/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=${per}&format=json&formatversion=2`,
        { signal, headers: { 'User-Agent': BROWSER_UA } },
      );
      return (j.query?.search ?? []).map((r: any) => ({
        id: `fandom:${base}:${r.pageid}`,
        source: 'fandom',
        kind: 'article' as const,
        title: r.title,
        snippet: stripHtml(r.snippet, 300),
        url: `${base}/wiki/${enc(r.title.replace(/ /g, '_'))}`,
        meta: { wiki: w.name },
      }));
    }),
  );
  return batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : [])).slice(0, limit);
};

/** WordPress-powered curiosity sites expose a public posts API. */
function wordpress(id: string, base: string): SearchFn {
  return async (q, { limit, signal }) => {
    const headers = { 'User-Agent': BROWSER_UA };
    const j = await getJson<any[]>(
      `${base}/wp-json/wp/v2/posts?search=${enc(q)}&per_page=${limit}&_fields=id,title,link,date,excerpt,jetpack_featured_media_url`,
      { signal, headers },
    );
    if (!j.length) {
      // Some sites keep stories in custom post types; the generic search endpoint sees those.
      const s = await getJson<any[]>(`${base}/wp-json/wp/v2/search?search=${enc(q)}&per_page=${limit}`, { signal, headers });
      return s.map((r) => ({
        id: `${id}:${r.id}`,
        source: id,
        kind: 'article' as const,
        title: stripHtml(r.title, 200),
        url: r.url,
      }));
    }
    return j.map((p) => ({
      id: `${id}:${p.id}`,
      source: id,
      kind: 'article' as const,
      title: stripHtml(p.title?.rendered, 200),
      snippet: stripHtml(p.excerpt?.rendered, 320),
      url: p.link,
      image: p.jetpack_featured_media_url || undefined,
      date: p.date?.slice(0, 10),
    }));
  };
}

export const damninteresting = wordpress('damninteresting', 'https://www.damninteresting.com');
export const futilitycloset = wordpress('futilitycloset', 'https://www.futilitycloset.com');

/** Stanford Encyclopedia of Philosophy's own search page. */
export const sep: SearchFn = async (q, { limit, signal }) => {
  const html = await getText(`https://plato.stanford.edu/search/searcher.py?query=${enc(q)}`, {
    signal,
    headers: HTML_HEADERS,
  });
  const doc = await parseHtml(html);
  const out: SourceItem[] = [];
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="entry=/entries/"]')) {
    const entry = a.getAttribute('href')?.match(/entry=(\/entries\/[^/&]+\/)/)?.[1];
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    const block = a.closest('.result_listing, li, div');
    out.push({
      id: `sep:${entry}`,
      source: 'sep',
      kind: 'article',
      title: a.textContent?.trim() || entry,
      snippet: stripHtml(block?.querySelector('.result_snippet, .result_snippets')?.textContent ?? '', 300),
      url: `https://plato.stanford.edu${entry}`,
    });
    if (out.length >= limit) break;
  }
  return out;
};

/** Sites with no API at all, searched through site-restricted web search. */
export const SITE_SEARCH: Record<string, string[]> = {
  lostmedia: ['lostmediawiki.com'],
  scp: ['scp-wiki.wikidot.com'],
  tvtropes: ['tvtropes.org'],
  rationalwiki: ['rationalwiki.org'],
  snopes: ['snopes.com'],
  knowyourmeme: ['knowyourmeme.com'],
  blackvault: ['theblackvault.com'],
  muckrock: ['muckrock.com'],
  truecrime: ['websleuths.com', 'doenetwork.org'],
  smithsonianmag: ['smithsonianmag.com'],
  substack: ['substack.com'],
  bellingcat: ['bellingcat.com'],
  dtic: ['apps.dtic.mil'],
  publicdomainreview: ['publicdomainreview.org'],
  cryptome: ['cryptome.org'],
  forums: ['abovetopsecret.com', 'unexplained-mysteries.com', 'godlikeproductions.com', 'archive.4plebs.org', 'metafilter.com', 'quora.com', 'stackexchange.com', 'tildes.net', 'city-data.com', 'forums.somethingawful.com'],
};

export const siteSearchers: Record<string, SearchFn> = Object.fromEntries(
  Object.entries(SITE_SEARCH).map(([id, sites]) => [
    id,
    (async (q, { limit, signal }) => {
      const query = sites.length === 1 ? `${q} site:${sites[0]}` : `${q} (${sites.map((s) => `site:${s}`).join(' OR ')})`;
      const items = await webSearch(query, limit + 4, signal);
      return items
        .filter((it) => sites.some((s) => host(it.url)?.endsWith(s)))
        .slice(0, limit)
        .map((it) => (it.kind === 'post' ? it : { ...it, id: `${id}:${it.url}`, source: id }));
    }) satisfies SearchFn,
  ]),
);
