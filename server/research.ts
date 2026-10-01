import type { SourceItem } from '../shared/types';
import { BROWSER_UA, enc, errMsg, getJson, sleep, stripHtml } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';
import { namesSubject, relevanceFilter, subjectName, terms } from './relevance';
import { readAnything } from './reader';
import { youtubeId } from './scrape';
import { youtubeTranscript } from './sources/media';
import { webSearch } from './sources/web';

// Deep research: what a good researcher does after the first search. Plan a few
// targeted searches, find the subject's fan wiki, read the best pages in full
// (not two-line snippets), and pull the wiki's pictures and character lists.

export interface Reading {
  title: string;
  url: string;
  source: string;
  text: string;
}

export interface Research {
  /** New evidence for the board (web results from the targeted searches, wiki pages). */
  items: SourceItem[];
  /** Pictures from the wiki pages that matter (screenshots, portraits). */
  photos: SourceItem[];
  /** A list the wiki keeps with a picture for each entry ("Boyfriends"), when one fits the case. */
  gallery?: { title: string; url: string; items: SourceItem[] };
  /** The relevant passages of pages read in full, for the AI. */
  reading: Reading[];
  queries: string[];
  wiki?: string;
}

const WIKI_HEADERS = { 'User-Agent': BROWSER_UA };
const NOT_READABLE = /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|play\.google\.com|apps\.apple\.com|pinterest\.)/;
const timeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), sleep(ms).then(() => fallback)]);

interface Plan {
  queries: string[];
  /** Where this kind of topic is really discussed: subreddits, forums, fan wikis, databases. */
  sites: string[];
}

/** The searches and the places a good researcher would use for this particular topic. */
async function planQueries(query: string, subject: string, clues: string, signal: AbortSignal): Promise<Plan> {
  const fallback: Plan = { queries: [`${subject} history`, `${subject} creator developer company`, `${subject} controversy`, `${subject} explained`], sites: [] };
  const plan = completeWithFallback(
    resolveProviders(),
    {
      messages: [
        {
          role: 'system',
          content:
            `You plan research like an expert librarian. Output only JSON: {"queries": ["…"], "sites": ["…"]}.
- queries: 5 short, specific web searches (3-8 words) that find the facts behind the topic: who made or runs it, when it started and ended, ownership or deals, the strange or disputed part, first-hand accounts. Each must contain the subject name exactly as given. Use names from the clues.
- sites: up to 4 places where THIS kind of topic is really documented or discussed, as domains or subreddits: e.g. a game → its fandom wiki, r/<the game or genre>, a gaming news site; a crime → court records, local news, websleuths.com; music → discogs.com, genius.com; film or TV → imdb.com, the fandom wiki; science → a journal or agency; internet lore → knowyourmeme.com, lostmediawiki.com. Pick only places likely to have this subject.`,
        },
        { role: 'user', content: `TOPIC: ${query}\nSUBJECT NAME: ${subject}\nWHAT A FIRST SEARCH TURNED UP:\n${clues.slice(0, 1800)}` },
      ],
      temperature: 0.3,
      maxTokens: 400,
      signal,
      timeoutMs: 9000,
    },
    (t) => {
      const j = parseJsonLoose<{ queries?: string[]; sites?: string[] }>(t);
      const qs = (j.queries ?? []).map((q) => String(q).trim()).filter((q) => q.length > 3 && q.length < 120);
      if (qs.length < 2) throw new Error('no queries');
      const sites = (j.sites ?? [])
        .map((x) => String(x).trim().replace(/^https?:\/\//, '').replace(/\/$/, ''))
        .filter((x) => /^(r\/\w+|[\w.-]+\.[a-z]{2,})/i.test(x))
        .slice(0, 4);
      return { queries: qs, sites };
    },
  ).then((r) => r.value);
  const got = await timeout(plan, 10000, fallback);
  // Every search must name the subject, so a vague one can't drift off topic.
  return { queries: [...new Set(got.queries.map((q) => (namesSubject(subject, q) ? q : `${subject} ${q}`)))].slice(0, 5), sites: got.sites };
}

// ── Fandom wikis ──

interface Wiki {
  name: string;
  base: string;
}

async function wikiApi<T = any>(wiki: Wiki, params: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  return getJson<T>(`${wiki.base}/api.php?${qs}`, { signal, headers: WIKI_HEADERS, timeout: 9000 });
}

/** The fan wiki about this subject: named after it, or with a page that is. */
async function findWiki(subject: string, signal: AbortSignal): Promise<Wiki | undefined> {
  const s = await getJson(`https://services.fandom.com/unified-search/community-search?query=${enc(subject)}&lang=en&limit=6`, { signal, headers: WIKI_HEADERS, timeout: 8000 }).catch(() => null);
  const wikis: Wiki[] = (s?.results ?? []).map((w: any) => ({ name: String(w.name), base: (String(w.url).startsWith('http') ? String(w.url) : `https://${w.url}`).replace(/\/$/, '') }));
  const named = wikis.find((w) => namesSubject(subject, w.name));
  if (named) return named;
  // Not named after it: a wiki that has a page with the subject's name (a person on a band's wiki).
  for (const w of wikis.slice(0, 3)) {
    const j = await wikiApi(w, { action: 'query', list: 'search', srsearch: subject, srlimit: 1 }, signal).catch(() => null);
    const top = j?.query?.search?.[0]?.title;
    if (top && namesSubject(subject, top) && namesSubject(top, subject)) return w;
  }
  return undefined;
}

const wikiUrl = (wiki: Wiki, title: string) => `${wiki.base}/wiki/${enc(title.replace(/ /g, '_'))}`;

async function wikiSearch(wiki: Wiki, q: string, limit: number, signal: AbortSignal): Promise<{ title: string; snippet: string }[]> {
  const j = await wikiApi(wiki, { action: 'query', list: 'search', srsearch: q, srlimit: limit }, signal).catch(() => null);
  return (j?.query?.search ?? []).map((r: any) => ({ title: String(r.title), snippet: stripHtml(r.snippet, 300) }));
}

async function wikiText(wiki: Wiki, title: string, signal: AbortSignal): Promise<string> {
  const j = await wikiApi(wiki, { action: 'parse', page: title, prop: 'text', redirects: 1 }, signal).catch(() => null);
  const html = String(j?.parse?.text ?? '')
    .replace(/<(script|style|table|aside|figure)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|div)>/gi, '\n\n');
  return stripHtml(html, 30000).replace(/\[\s*\]/g, '');
}

/** The pictures on a wiki page, skipping icons and decorations. */
async function wikiImages(wiki: Wiki, title: string, caption: string, limit: number, signal: AbortSignal): Promise<SourceItem[]> {
  const j = await wikiApi(wiki, { action: 'query', generator: 'images', titles: title, gimlimit: 30, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: 640 }, signal).catch(() => null);
  return ((j?.query?.pages ?? []) as any[])
    .map((p) => ({ name: String(p.title).replace(/^File:/, ''), info: p.imageinfo?.[0] }))
    .filter(({ name, info }) => info?.thumburl && (info.width ?? 0) >= 160 && !/(icon|logo|badge|button|wordmark|favicon|placeholder|\.svg$)/i.test(name))
    .slice(0, limit)
    .map(({ name, info }) => ({
      id: `fandom-img:${wiki.base}:${name}`,
      source: 'fandom',
      kind: 'image' as const,
      title: `${title}: ${name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ')}`,
      snippet: `${caption}, from ${wiki.name}`,
      url: info.descriptionurl ?? wikiUrl(wiki, title),
      image: info.thumburl,
      meta: { wiki: wiki.name },
    }));
}

/** A list page ("Boyfriends") whose entries mostly have pictures: shown as a gallery of who's who. */
async function wikiGallery(wiki: Wiki, title: string, subject: string, signal: AbortSignal, hop = 0): Promise<Research['gallery']> {
  const j = await wikiApi(wiki, { action: 'query', generator: 'links', titles: title, gpllimit: 80, gplnamespace: 0, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 320, redirects: 1 }, signal).catch(() => null);
  const linked = (j?.query?.pages ?? []) as any[];
  // "Boyfriends" can be an index of per-game lists: follow it to "Boyfriends (Star Girl)".
  if (!hop) {
    const own = linked.find((p) => String(p.title).startsWith(`${title} (`) && namesSubject(subject, String(p.title)));
    if (own) {
      const deeper = await wikiGallery(wiki, String(own.title), subject, signal, 1);
      if (deeper) return deeper;
    }
  }
  const members = linked.filter((p) => p.thumbnail?.source && !namesSubject(subject, String(p.title)));
  if (members.length < 8 || members.length < linked.length * 0.45) return undefined;
  const label = title.replace(/\s*\(.*\)\s*$/, '');
  return {
    title,
    url: wikiUrl(wiki, title),
    items: members.slice(0, 10).map((p) => ({
      id: `fandom:${wiki.base}:${p.pageid}`,
      source: 'fandom',
      kind: 'image' as const,
      title: String(p.title),
      snippet: `One of the ${label} in ${subject} (${wiki.name})`,
      url: wikiUrl(wiki, String(p.title)),
      image: p.thumbnail.source,
      meta: { wiki: wiki.name, list: label },
    })),
  };
}

/** Every article a wiki page links to: where the parts of a case live. */
async function wikiLinks(wiki: Wiki, title: string, signal: AbortSignal): Promise<string[]> {
  const j = await wikiApi(wiki, { action: 'query', prop: 'links', titles: title, pllimit: 500, plnamespace: 0 }, signal).catch(() => null);
  return ((j?.query?.pages?.[0]?.links ?? []) as any[]).map((l) => String(l.title));
}

/** The AI picks the wiki pages that explain the case, and the one list (characters, members, items) central to it. */
async function pickWikiPages(query: string, wikiName: string, excerpt: string, pool: string[], signal: AbortSignal): Promise<{ pages: string[]; list?: string } | null> {
  if (!pool.length) return null;
  const known = new Map(pool.map((t) => [t.toLowerCase(), t]));
  const r = await completeWithFallback(
    resolveProviders(),
    {
      messages: [
        { role: 'system', content: 'You pick wiki pages for a researcher. Output only JSON: {"pages": ["exact title"], "list": "exact title or empty"}.' },
        {
          role: 'user',
          content: `CASE: ${query}\nWHAT THE SOURCES SAY:\n${excerpt}\n\nPAGES ON ${wikiName}:\n${pool.join(' | ')}\n\nPick up to 3 pages that explain THIS case: the specific feature, person, event or item at the centre of what the sources discuss (for a controversy, the page about the thing that caused it), not editions, versions or spin-offs of the subject. Add the subject's main page last, only if room is left. Then, if one page is a list of characters, members, items or episodes central to the case (for example the people involved), give it as "list". Use exact titles from the list above.`,
        },
      ],
      temperature: 0,
      maxTokens: 300,
      signal,
      timeoutMs: 11000,
    },
    (t) => {
      const j = parseJsonLoose<{ pages?: string[]; list?: string }>(t);
      const pages = (j.pages ?? []).map((p) => known.get(String(p).toLowerCase())).filter((p): p is string => !!p).slice(0, 3);
      const list = j.list ? known.get(String(j.list).toLowerCase()) : undefined;
      if (!pages.length && !list) throw new Error('no valid pages');
      return { pages, list };
    },
  ).catch(() => null);
  return r?.value ?? null;
}
/** A title like "Boyfriends (Star Girl)" or "Characters": a plural common noun, not the subject itself. */
const listLike = (title: string, subject: string) => {
  const main = title.replace(/\s*\(.*\)\s*$/, '').trim();
  return /^[A-Z]?[a-z]+s$|^[A-Z][a-z]+ [a-z]+s$/.test(main) && !namesSubject(subject, main);
};

// ── Reading pages in full ──

/** The paragraphs of a page that are about the case, in order, up to `max` characters. */
// Words a search plan uses that are about searching, not about the subject.
const PLAN_WORDS = new Set('launch launched release released date year years history developer developers creator company owner ownership acquisition deal deals shutdown closure closed removal removed controversy dispute disputes explained reason reasons timeline origin origins accounts account first hand reviews review news article articles interview interviews official statement report reports reddit forum forums discussion discussions wiki fandom site'.split(' '));

const COMMON = new Set(
  'successful brand brands google apple store stores official free popular famous about above after again against almost along already although always among another anyone anything around because become before being below between beyond could didnt doesnt during either enough every everything example first found friends going great having however include including later least little looking major might never often other others people perhaps place played player players playing please point possible probably quite rather really right second seems should since small something sometimes start started still story stuff thing things think those though three through today together under until using version video videos where whether which while whole within without world would years young based called comments content download games gamer gamers mobile online share posted reply update updated users watch thanks thank years later around maybe actually remember'.split(' '),
);

/** Words that come up across several sources: the names and features a case is really about. */
function salientTerms(texts: string[], subject: string, n: number): string[] {
  const own = new Set([...terms(subject), terms(subject).join('')]);
  const docs = new Map<string, number>();
  for (const t of texts) {
    const words = new Set(terms(t).filter((w) => w.length >= 5 && !COMMON.has(w) && !own.has(w) && !/^\d+$/.test(w)));
    for (const w of words) docs.set(w, (docs.get(w) ?? 0) + 1);
  }
  return [...docs].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function passages(text: string, keywords: string[], max: number): string {
  const paras = text
    .split(/\n{2,}|\n(?=[A-Z#*•-])/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 60);
  const score = (p: string) => {
    const low = p.toLowerCase();
    return keywords.reduce((s, k) => s + (low.includes(k) ? 1 : 0), 0) + (/\b(1[89]\d\d|20[0-4]\d)\b/.test(p) ? 0.5 : 0);
  };
  const ranked = paras.map((p, i) => ({ p, i, s: score(p) })).filter((x) => x.s >= 1);
  const keep = new Set<number>();
  let used = 0;
  for (const x of [...ranked].sort((a, b) => b.s - a.s)) {
    if (used + x.p.length > max) continue;
    keep.add(x.i);
    used += x.p.length;
  }
  return ranked
    .filter((x) => keep.has(x.i))
    .map((x) => x.p)
    .join('\n');
}

async function readPage(url: string, signal: AbortSignal): Promise<{ title: string; text: string } | null> {
  const yt = youtubeId(url);
  if (yt) {
    const t = await youtubeTranscript(yt).catch(() => null);
    return t ? { title: `${t.title} (video transcript)`, text: t.text } : null;
  }
  if (signal.aborted) return null;
  const page = await readAnything(url).catch(() => null);
  if (!page || page.blocked) return null;
  return { title: page.title, text: [page.text, ...(page.comments ?? []).slice(0, 15).map((c) => c.text)].join('\n\n') };
}

/**
 * Runs the deep pass. `scout` is what the first web search found (its snippets
 * seed the plan); `isRelevant` is the dig's own relevance filter.
 */
export async function deepResearch(
  query: string,
  scout: SourceItem[],
  isRelevant: (it: SourceItem) => boolean,
  signal: AbortSignal,
  onStatus: (m: string) => void,
): Promise<Research> {
  const subject = subjectName(query);
  const clues = scout.map((s) => `- ${s.title}: ${s.snippet ?? ''}`).join('\n');
  const [plan, wiki] = await Promise.all([planQueries(query, subject, clues, signal), timeout(findWiki(subject, signal), 9000, undefined)]);
  const queries = plan.queries;
  // The places this topic lives: searched for the subject, inside each one.
  const siteSearches = plan.sites
    .filter((x) => !(wiki && x.includes(new URL(wiki.base).hostname)))
    .map((x) => (x.startsWith('r/') ? `${subject} reddit ${x}` : `${subject} site:${x}`));
  const places = [...plan.sites, ...(wiki ? [wiki.name] : [])];
  onStatus(`Researching ${queries.length} angles${places.length ? ` and ${places.slice(0, 4).join(', ')}` : ''}…`);
  const keywords = [...new Set([...terms(subject), ...queries.flatMap(terms)])].filter((w) => w.length >= 4);

  // Targeted searches on the web and on the wiki, in parallel.
  const [webBatches, wikiHits] = await Promise.all([
    Promise.all([...queries, ...siteSearches].map((q) => timeout(webSearch(q, 5, signal), 12000, [] as SourceItem[]))),
    wiki ? Promise.all([query, subject, ...queries].map((q) => timeout(wikiSearch(wiki, q, 3, signal), 8000, []))) : Promise.resolve([]),
  ]);
  const seen = new Set(scout.map((s) => s.url));
  const items: SourceItem[] = [];
  for (const batch of webBatches) {
    for (const it of batch) {
      if (!it.url || seen.has(it.url) || !isRelevant(it)) continue;
      seen.add(it.url);
      items.push(it);
    }
  }

  // Read the best web pages in full first: what they talk about steers the wiki and the pictures.
  onStatus('Reading the best pages in full…');
  const byDomain = new Map<string, number>();
  const toRead = [...scout, ...items]
    .filter((it) => it.url && it.source !== 'fandom' && !NOT_READABLE.test(new URL(it.url).hostname))
    .filter((it) => {
      const d = new URL(it.url!).hostname.replace(/^www\./, '');
      byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
      return byDomain.get(d)! <= 1;
    })
    .slice(0, 6);
  const webTexts = await Promise.all(toRead.map((it) => timeout(readPage(it.url!, signal), 11000, null)));
  const corpus = [...scout.map((x) => `${x.title} ${x.snippet ?? ''}`), ...webTexts.map((p) => p?.text ?? '')];
  // The names and features the sources keep coming back to ("starchat", "boyfriends", "animoca").
  const salient = salientTerms(corpus, subject, 8);

  // Wiki: gather candidate pages (the searches' hits, and every page the subject's main page links to),
  // then let the AI pick the ones that explain this case, the way a researcher would.
  const mainTitle = (t: string) => t.replace(/\s*\(.*\)\s*$/, '');
  let topWiki: string[] = [];
  let listPage: string | undefined;
  let pool: string[] = [];
  if (wiki) {
    const hitTitles = [...new Set(wikiHits.flat().map((h) => h.title))];
    const mainPage = hitTitles.find((t) => namesSubject(subject, mainTitle(t)));
    // The pages the searches hit, plus everything they link to: that's where a case's parts and lists live.
    const linked = (await Promise.all(hitTitles.slice(0, 14).map((t) => timeout(wikiLinks(wiki, t, signal), 8000, [] as string[])))).flat();
    pool = [...new Set([...hitTitles, ...linked])].slice(0, 240);
    const excerpt = corpus.map((t) => t.replace(/\s+/g, ' ').slice(0, 500)).join('\n').slice(0, 3000);
    const pick = await timeout(pickWikiPages(query, wiki.name, excerpt, pool, signal), 12000, null);
    // A picked page that is plainly a list ("Boyfriends") is the gallery, not reading.
    if (pick && !pick.list) {
      const l = pick.pages.find((t) => listLike(t, subject));
      if (l) {
        pick.list = l;
        pick.pages = pick.pages.filter((t) => t !== l);
      }
    }
    topWiki = pick?.pages.length ? pick.pages : [...hitTitles.filter((t) => !namesSubject(subject, mainTitle(t))).slice(0, 2), ...(mainPage ? [mainPage] : [])];
    listPage = pick?.list;
    if (process.env.RH_DEBUG) console.log('[research] wiki pool', pool.length, JSON.stringify(pool.filter((t) => /boyfriend|chat/i.test(t))), 'hits', JSON.stringify(hitTitles), 'picked', JSON.stringify(pick));
    for (const title of topWiki) {
      const snippet = wikiHits.flat().find((h) => h.title === title)?.snippet ?? '';
      items.push({ id: `fandom:${wiki.base}:${title}`, source: 'fandom', kind: 'article', title, snippet, url: wikiUrl(wiki, title), meta: { wiki: wiki.name } });
    }
  }
  const wikiTexts = wiki ? await Promise.all(topWiki.map((t) => timeout(wikiText(wiki, t, signal), 8000, ''))) : [];

  const allKeywords = [...new Set([...keywords, ...salient])];
  const reading: Reading[] = [];
  topWiki.forEach((t, i) => {
    const text = passages(wikiTexts[i] ?? '', allKeywords, 1500) || (wikiTexts[i] ?? '').slice(0, 1200);
    if (text.length > 120) reading.push({ title: `${t} (${wiki!.name})`, url: wikiUrl(wiki!, t), source: 'fandom', text });
  });
  toRead.forEach((it, i) => {
    const page = webTexts[i];
    const text = page ? passages(page.text, allKeywords, 1200) : '';
    if (text.length > 120) reading.push({ title: page!.title || it.title, url: it.url!, source: it.source, text });
  });

  // Pictures: the picked wiki pages' images, and the who's-who list the AI chose.
  let photos: SourceItem[] = [];
  let gallery: Research['gallery'];
  if (wiki) {
    // No list from the AI: the list page that what we read mentions most ("talk with Boyfriends").
    if (!listPage) {
      const text = [...corpus, ...wikiTexts].join(' ').toLowerCase();
      const mentions = (t: string) => text.split(mainTitle(t).toLowerCase().replace(/s$/, '')).length - 1;
      listPage = pool
        .filter((t) => listLike(t, subject))
        .map((t) => ({ t, m: mentions(t) }))
        .filter((x) => x.m > 0)
        .sort((a, b) => b.m - a.m)[0]?.t;
    }
    const [pics, list] = await Promise.all([
      // Pictures from pages about specific things (a feature, a person) first; the subject's own pages add one at most.
      Promise.all(
        [...topWiki.filter((t) => !namesSubject(subject, mainTitle(t))), ...topWiki.filter((t) => namesSubject(subject, mainTitle(t)))]
          .slice(0, 3)
          .map((t) => timeout(wikiImages(wiki, t, `On the ${t} page`, namesSubject(subject, mainTitle(t)) ? 1 : 4, signal), 8000, [])),
      ),
      listPage ? timeout(wikiGallery(wiki, listPage, subject, signal), 9000, undefined) : Promise.resolve(undefined),
    ]);
    photos = pics.flat();
    gallery = list;
  }
  return { items, photos, gallery, reading, queries: [...queries, ...siteSearches], wiki: wiki?.name };
}

export function describeError(e: unknown) {
  return errMsg(e);
}
