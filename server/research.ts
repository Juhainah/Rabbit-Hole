import type { SourceItem } from '../shared/types';
import { BROWSER_UA, enc, errMsg, getJson, sleep, stripHtml } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';
import { namesSubject, relevanceFilter, subjectName, terms } from './relevance';
import { readAnything } from './reader';
import { youtubeId } from './scrape';
import { youtubeTranscript } from './sources/media';
import { serper, webSearch } from './sources/web';

// Deep research: what a good researcher does after the first search. Plan a few
// targeted searches, find the subject's fan wiki, read the best pages in full
// (not two-line snippets), and pull the wiki's pictures and character lists.

export interface Reading {
  title: string;
  url: string;
  source: string;
  text: string;
  date?: string;
}

export interface Research {
  /** New evidence for the board (web results from the targeted searches, wiki pages). */
  items: SourceItem[];
  /** Pictures from the wiki pages that matter (screenshots, portraits). */
  photos: SourceItem[];
  /** A list the wiki keeps with a picture for each entry ("Boyfriends"), when one fits the case. */
  /** `about`: the page the list belongs to (the feature a list of characters comes from), so the board can tie them. */
  gallery?: { title: string; url: string; items: SourceItem[]; about?: string; label?: string };
  /** The relevant passages of pages read in full, for the AI. */
  reading: Reading[];
  queries: string[];
  wiki?: string;
  /** Words this case's own sources keep using ("animoca", "boyfriends", "simsimi"): what a namesake lacks. */
  vocabulary: string[];
}

const WIKI_HEADERS = { 'User-Agent': BROWSER_UA };
/** Words in a search that ask about a subject rather than name a set of things in it. */
const GENERIC_ASK = new Set('controversy scandal history story theory theories conspiracy mystery explained facts truth death leaving drama rumor rumors news game games movie film show series book anime manga character characters'.split(' '));

// Listing pages (topics, tags, search results) mention everything and explain nothing.
const LISTING = /\/(topics?|tags?|categor(y|ies)|search|explore|hashtag)(\/|$)/i;
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
- queries: 5 short, specific web searches (3-8 words) that find the facts behind the topic: who made or runs it, when it started and ended, ownership or deals, the strange or disputed part, first-hand accounts. The FIRST search must find news coverage from when it happened (add the year, e.g. "<subject> acquired 2014"); the SECOND must name who made or owns it. Each must contain the subject name exactly as given. Use names from the clues.
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
  return { queries: [...new Set(got.queries.map((q) => (namesSubject(subject, q) ? q : `${subject} ${q}`)))].slice(0, 4), sites: got.sites };
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
/**
 * `context` is the whole search ("zayn leaving one direction"): a wiki named after something in it
 * (the One Direction wiki) may hold the subject's page; any other wiki that merely has a page with
 * the same name is a namesake (a cartoon's "The Bermuda Triangle" episode).
 */
export async function findWiki(subject: string, signal: AbortSignal, context = ''): Promise<Wiki | undefined> {
  const search = (q: string) =>
    getJson(`https://services.fandom.com/unified-search/community-search?query=${enc(q)}&lang=en&limit=6`, { signal, headers: WIKI_HEADERS, timeout: 8000 })
      .then((s) => (s?.results ?? []).map((w: any) => ({ name: String(w.name), base: (String(w.url).startsWith('http') ? String(w.url) : `https://${w.url}`).replace(/\/$/, '') })) as Wiki[])
      .catch(() => [] as Wiki[]);
  // Fandom's wiki search matches wiki names, so besides the subject, the search's other words and pairs of
  // words are tried on their own: one of them is usually the franchise ("supernatural", "fairy tail").
  const own = new Set(terms(subject));
  const rest = terms(context.split(/\s+/).slice(0, 10).join(' ')).filter((w) => !own.has(w) && w.length >= 4);
  const phrases = [...new Set([...rest.slice(0, 4).map((w, i) => (rest[i + 1] ? `${w} ${rest[i + 1]}` : '')), ...rest.slice(0, 3)])].filter(Boolean).slice(0, 5);
  const lists = await Promise.all([search(subject), ...phrases.map(search)]);
  const seen = new Set<string>();
  const wikis = lists.flat().filter((w) => !seen.has(w.base) && seen.add(w.base));
  const core = (name: string) => name.replace(/\b(wiki|fandom|wikia|database|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // A wiki named after something else the search says ("Supernatural", "Fairy Tail") is where its subject lives,
  // if it has a page for the subject: "The Colt" is on the Supernatural wiki, not a game called Colt Canyon.
  const franchise = wikis.filter((x) => core(x.name) && !namesSubject(subject, core(x.name)) && namesSubject(core(x.name), context));
  for (const w of franchise.slice(0, 3)) {
    const j = await wikiApi(w, { action: 'query', list: 'search', srsearch: subject, srlimit: 1 }, signal).catch(() => null);
    const top = j?.query?.search?.[0]?.title;
    if (top && namesSubject(subject, top)) return w;
  }
  const named = wikis.find((w) => namesSubject(subject, w.name));
  if (named) return named;
  // Not named after it: a wiki that has a page with the subject's name (a person on a band's wiki).
  for (const w of wikis.slice(0, 4).filter((x) => core(x.name) && namesSubject(core(x.name), context))) {
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
async function wikiGallery(wiki: Wiki, title: string, subject: string, signal: AbortSignal, hop = 0, max = 60): Promise<Research['gallery']> {
  // Every page the list links to, with its picture (the wiki hands pictures out 50 at a time).
  const linked: any[] = [];
  let cont: Record<string, string> = {};
  for (let round = 0; round < 4; round++) {
    const j = await wikiApi(wiki, { action: 'query', generator: 'links', titles: title, gpllimit: 'max', gplnamespace: 0, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 330, pilimit: 'max', redirects: 1, ...cont }, signal).catch(() => null);
    for (const p of (j?.query?.pages ?? []) as any[]) {
      const had = linked.find((x) => x.pageid === p.pageid);
      if (had) had.thumbnail ??= p.thumbnail;
      else linked.push(p);
    }
    if (!j?.continue) break;
    cont = Object.fromEntries(Object.entries(j.continue).map(([k, v]) => [k, String(v)]));
  }
  // "Boyfriends" can be an index of per-game lists: follow it to "Boyfriends (Star Girl)".
  if (!hop) {
    const own = linked.find((p) => String(p.title).startsWith(`${title} (`) && namesSubject(subject, String(p.title)));
    if (own) {
      const deeper = await wikiGallery(wiki, String(own.title), subject, signal, 1, max);
      if (deeper) return deeper;
    }
  }
  const members = linked.filter((p) => p.thumbnail?.source && !namesSubject(subject, String(p.title)));
  if (members.length < 5 || members.length < linked.length * 0.35) return undefined;
  const label = title.replace(/\s*\(.*\)\s*$/, '');
  return {
    title,
    url: wikiUrl(wiki, title),
    items: members.slice(0, max).map((p) => ({
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

/**
 * The whole list behind a who's-who card, read from its wiki link ("https://x.fandom.com/wiki/Boyfriends").
 * `subject` is the case it belongs to, so the subject's own pages are not counted as members.
 */
export async function galleryFromUrl(url: string, subject: string, signal: AbortSignal): Promise<Research['gallery']> {
  const u = new URL(url);
  if (!/\.fandom\.com$/.test(u.hostname)) throw new Error('Not a Fandom wiki page');
  const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
  const wiki: Wiki = { name: u.hostname.split('.')[0], base: `${u.protocol}//${u.hostname}` };
  return wikiGallery(wiki, title, subject, signal, 0, 120);
}

/**
 * A list from a subject's fan wiki, by what it holds: "Lucy's gate keys" in Fairy Tail, "weapons" in
 * Supernatural, "recipes" in a cooking game. The wiki's own pages are searched for the list, and the first
 * one whose members are mostly pictured becomes a gallery, labelled with what it is.
 */
export async function findList(subject: string, what: string, signal: AbortSignal): Promise<(Research['gallery'] & { label: string; wiki: string }) | undefined> {
  const wiki = await findWiki(subject, signal, what);
  if (!wiki) return undefined;
  // Fan wikis file every key, weapon or recipe under a category: the most exact list there is.
  const fromCategory = await categoryGallery(wiki, subject, what, signal);
  if (fromCategory) return fromCategory;
  const hits = [...(await wikiSearch(wiki, what, 8, signal)), ...(await wikiSearch(wiki, `List of ${what}`, 4, signal))];
  const words = new Set(terms(what));
  const fits = (t: string) => terms(t).filter((w) => words.has(w)).length;
  // Pages named like the list asked for first ("Celestial Spirits" for "celestial spirit keys").
  const titles = [...new Set(hits.map((h) => h.title))].filter((t) => fits(t) > 0).sort((a, b) => fits(b) - fits(a) || Number(listLike(b, subject)) - Number(listLike(a, subject)));
  for (const t of titles.slice(0, 4)) {
    const g = await timeout(wikiGallery(wiki, t, subject, signal, 0, 80), 12000, undefined);
    if (g) return { ...g, label: t.replace(/\s*\(.*\)\s*$/, ''), wiki: wiki.name };
  }
  // A list kept as a table on one page ("List of … Dishes"): its rows, with pictures when the table has them.
  const tablePages = [...new Set([...titles, ...hits.map((h) => h.title)])].filter((t) => /^list of /i.test(t) || fits(t) > 0).slice(0, 3);
  for (const t of tablePages) {
    const g = await timeout(tableList(wiki, t, subject, signal), 12000, undefined);
    if (g) return { ...g, wiki: wiki.name };
  }
  return undefined;
}

/** The first table on a page with a name column, as list items (name, a detail line, a picture if any). */
async function tableList(wiki: Wiki, title: string, subject: string, signal: AbortSignal): Promise<(Research['gallery'] & { label: string }) | undefined> {
  const j = await wikiApi(wiki, { action: 'parse', page: title, prop: 'text', redirects: 1 }, signal).catch(() => null);
  const html = String(j?.parse?.text ?? '');
  const page = String(j?.parse?.title ?? title);
  for (const table of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (rows.length < 6) continue;
    const cellsOf = (r: string) => (r.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => stripHtml(c, 120).replace(/\s+/g, ' ').trim());
    const head = cellsOf(rows[0] ?? '');
    const items: SourceItem[] = [];
    for (const r of rows.slice(1)) {
      const cells = cellsOf(r);
      const name = cells.find((c) => /[A-Za-z]{2,}/.test(c));
      if (!name || name.length > 60) continue;
      const img = r.match(/<img[^>]+(?:data-src|src)="(https:[^"]+)"/i)?.[1]?.replace(/\/scale-to-width-down\/\d+/, '/scale-to-width-down/330');
      const link = r.match(/<a [^>]*href="\/wiki\/([^"#?]+)"/i)?.[1];
      // Two telling columns as the detail line ("Level: 1 · Time: 1min").
      const detail = cells
        .map((c, i) => (c && c !== name && head[i] ? `${head[i]}: ${c}` : ''))
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');
      items.push({
        id: `fandom:${wiki.base}:${page}:${name}`,
        source: 'fandom',
        kind: 'image',
        title: name,
        snippet: `${name} in ${subject} (${wiki.name})`,
        url: link ? wikiUrl(wiki, decodeURIComponent(link).replace(/_/g, ' ')) : wikiUrl(wiki, page),
        image: img && !/data:image/.test(img) ? img : undefined,
        meta: detail ? { role: detail.slice(0, 70) } : undefined,
      });
      if (items.length >= 80) break;
    }
    if (items.length >= 5) {
      const label = page.replace(/^List of /i, '').replace(/\s*\(.*\)\s*$/, '');
      return { title: page, url: wikiUrl(wiki, page), label: label.slice(0, 40), items };
    }
  }
  return undefined;
}

/** The wiki category that best matches what was asked for, as a pictured list. */
async function categoryGallery(wiki: Wiki, subject: string, what: string, signal: AbortSignal): Promise<(Research['gallery'] & { label: string; wiki: string }) | undefined> {
  const words = terms(what);
  // "celestial spirit keys" also tries "celestial spirits": the object word is often not in the category name.
  const tries = [...new Set([what, words.slice(0, -1).join(' '), ...words])].filter((q) => q.trim().length > 2).slice(0, 4);
  const found = new Set<string>();
  for (const q of tries) {
    const j = await wikiApi(wiki, { action: 'query', list: 'search', srsearch: q, srnamespace: 14, srlimit: 8 }, signal).catch(() => null);
    for (const r of (j?.query?.search ?? []) as { title: string }[]) found.add(String(r.title));
    if (found.size >= 6) break;
  }
  // Category names the wiki's search misses ("Celestial Spirit"): look them up by their first word.
  for (const w of words.slice(0, 2)) {
    const prefix = w[0].toUpperCase() + w.slice(1);
    const j = await wikiApi(wiki, { action: 'query', list: 'allcategories', acprefix: prefix, aclimit: 15 }, signal).catch(() => null);
    for (const c of (j?.query?.allcategories ?? []) as { category?: string; '*'?: string }[]) found.add(`Category:${c.category ?? c['*']}`);
  }
  const name = (c: string) => c.replace(/^Category:/, '');
  const wanted = new Set(words);
  const score = (c: string) => {
    const t = terms(name(c));
    const hit = t.filter((w) => wanted.has(w)).length;
    // Picture folders and "articles related to…" are not the list itself.
    if (!hit || /^(images?|pictures?|gallery|files?|articles|pages|stubs?|navboxes?|templates?) /i.test(name(c)) || /\b(images|stubs|templates|navigation)\b/i.test(name(c))) return 0;
    return hit * 10 - (t.length - hit);
  };
  const ranked = [...found].map((c) => ({ c, s: score(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  for (const { c } of ranked.slice(0, 3)) {
    const j = await wikiApi(
      wiki,
      { action: 'query', generator: 'categorymembers', gcmtitle: c, gcmnamespace: 0, gcmlimit: 50, prop: 'pageimages', piprop: 'thumbnail', pithumbsize: 330, pilimit: 'max' },
      signal,
    ).catch(() => null);
    const members = ((j?.query?.pages ?? []) as any[]).filter((p) => !namesSubject(subject, String(p.title)));
    const pictured = members.filter((p) => p.thumbnail?.source);
    if (members.length < 3 || pictured.length < Math.min(3, members.length * 0.4)) continue;
    const label = name(c);
    return {
      title: label,
      url: wikiUrl(wiki, c),
      label,
      wiki: wiki.name,
      items: [...pictured, ...members.filter((p) => !p.thumbnail?.source)].slice(0, 80).map((p) => ({
        id: `fandom:${wiki.base}:${p.pageid}`,
        source: 'fandom',
        kind: 'image' as const,
        title: String(p.title),
        snippet: `One of the ${label} in ${subject} (${wiki.name})`,
        url: wikiUrl(wiki, String(p.title)),
        image: p.thumbnail?.source,
        meta: { wiki: wiki.name, list: label },
      })),
    };
  }
  return undefined;
}
/** Every article a wiki page links to: where the parts of a case live. */
async function wikiLinks(wiki: Wiki, title: string, signal: AbortSignal): Promise<string[]> {
  const j = await wikiApi(wiki, { action: 'query', prop: 'links', titles: title, pllimit: 500, plnamespace: 0 }, signal).catch(() => null);
  return ((j?.query?.pages?.[0]?.links ?? []) as any[]).map((l) => String(l.title));
}

/** The AI picks the wiki pages that explain the case, and the one list (characters, members, items) central to it. */
async function pickWikiPages(query: string, wikiName: string, excerpt: string, pool: string[], signal: AbortSignal): Promise<{ pages: string[]; list?: string; listLabel?: string } | null> {
  if (!pool.length) return null;
  const known = new Map(pool.map((t) => [t.toLowerCase(), t]));
  const r = await completeWithFallback(
    resolveProviders(),
    {
      messages: [
        { role: 'system', content: 'You pick wiki pages for a researcher. Output only JSON: {"pages": ["exact title"], "list": "exact title or empty", "listLabel": "2-3 words naming what the list holds, e.g. Who\'s who (people), The keys, Weapons, Recipes"}.' },
        {
          role: 'user',
          content: `CASE: ${query}\nWHAT THE SOURCES SAY:\n${excerpt}\n\nPAGES ON ${wikiName}:\n${pool.join(' | ')}\n\nPick up to 3 pages that explain THIS case: the specific feature, person, event or item at the centre of what the sources discuss (for a controversy, the page about the thing that caused it), not editions, versions or spin-offs of the subject. Add the subject's main page last, only if room is left. Then, if one page is a list of characters, members, objects, items or episodes central to the case (the people involved, or the objects the search is about, like a set of magic keys or weapons), give it as "list". Use exact titles from the list above.`,
        },
      ],
      temperature: 0,
      maxTokens: 300,
      signal,
      timeoutMs: 11000,
    },
    (t) => {
      const j = parseJsonLoose<{ pages?: string[]; list?: string; listLabel?: string }>(t);
      const pages = (j.pages ?? []).map((p) => known.get(String(p).toLowerCase())).filter((p): p is string => !!p).slice(0, 3);
      const list = j.list ? known.get(String(j.list).toLowerCase()) : undefined;
      if (!pages.length && !list) throw new Error('no valid pages');
      return { pages, list, listLabel: typeof j.listLabel === 'string' ? j.listLabel.trim().slice(0, 30) : undefined };
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

async function readPage(url: string, signal: AbortSignal): Promise<{ title: string; text: string; published?: string } | null> {
  const yt = youtubeId(url);
  if (yt) {
    const t = await youtubeTranscript(yt).catch(() => null);
    return t ? { title: `${t.title} (video transcript)`, text: t.text } : null;
  }
  if (signal.aborted) return null;
  const page = await readAnything(url).catch(() => null);
  if (!page || page.blocked) return null;
  return { title: page.title, published: page.published, text: [page.text, ...(page.comments ?? []).slice(0, 15).map((c) => c.text)].join('\n\n') };
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
  /** The search already understood (subject, planned searches, places): no second planning round. */
  given?: { subject: string; queries: string[]; sites: string[]; focus: string[] },
): Promise<Research> {
  const subject = given?.subject ?? subjectName(query);
  const clues = scout.map((s) => `- ${s.title}: ${s.snippet ?? ''}`).join('\n');
  const planned = given?.queries.length
    ? Promise.resolve({ queries: [...new Set(given.queries.map((q) => (namesSubject(subject, q) ? q : `${subject} ${q}`)))].slice(0, 4), sites: given.sites })
    : planQueries(query, subject, clues, signal);
  const [plan, wiki] = await Promise.all([planned, timeout(findWiki(subject, signal, `${query} ${(given?.focus ?? []).join(' ')}`), 15000, undefined)]);
  const queries = plan.queries;
  // The places this topic lives: searched for the subject, inside each one.
  // Two places at most: each search spends from a small free allowance.
  const siteSearches = plan.sites
    .filter((x) => !(wiki && x.includes(new URL(wiki.base).hostname)))
    .slice(0, 2)
    .map((x) => (x.startsWith('r/') ? `${subject} reddit ${x}` : `${subject} site:${x}`));
  const places = [...plan.sites, ...(wiki ? [wiki.name] : [])];
  onStatus(`Researching ${queries.length} angles${places.length ? ` and ${places.slice(0, 4).join(', ')}` : ''}…`);
  const keywords = [...new Set([...terms(subject), ...(given?.focus ?? []).flatMap(terms), ...queries.flatMap(terms)])].filter((w) => w.length >= 4);

  // Targeted searches on the web and on the wiki, in parallel.
  const [webBatches, wikiHits] = await Promise.all([
    Promise.all(
      [...queries, ...siteSearches].map((q, i) =>
        // Google (Serper) for the two key searches: it finds coverage from the time that other engines miss.
        timeout(i < 2 ? serper(q, 6, signal).then((r) => (r.length ? r : webSearch(q, 5, signal))).catch(() => webSearch(q, 5, signal)) : webSearch(q, 5, signal), 12000, [] as SourceItem[]),
      ),
    ),
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
    .filter((it) => it.url && it.source !== 'fandom' && !NOT_READABLE.test(new URL(it.url).hostname) && !LISTING.test(new URL(it.url).pathname))
    // Only pages about the subject itself: a topic page that lists it among a hundred petitions is not.
    .filter((it) => namesSubject(subject, it.title) || namesSubject(subject, `${it.title} ${it.snippet ?? ''}`.slice(0, 220)))
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
  let listLabel: string | undefined;
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
    listLabel = pick?.listLabel;
    if (process.env.RH_DEBUG) console.log('[research] wiki pool', pool.length, JSON.stringify(pool.slice(0, 12)), 'hits', JSON.stringify(hitTitles), 'picked', JSON.stringify(pick));
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
    // When it came out anchors the timeline: news of a 2014 sale is dated 2014.
    const date = (page?.published ?? it.date ?? '').slice(0, 10) || undefined;
    if (text.length > 120) reading.push({ title: page!.title || it.title, url: it.url!, source: it.source, text, date });
  });

  // Pictures: the picked wiki pages' images, and the who's-who list the AI chose.
  let photos: SourceItem[] = [];
  let gallery: Research['gallery'];
  if (wiki) {
    // The list page that what we read mentions most ("talk with Boyfriends"): used when the AI picked
    // none, or picked a page that is not a list (the feature page itself), or its list has no pictures.
    const text = [...corpus, ...wikiTexts].join(' ').toLowerCase();
    const mentions = (t: string) => text.split(mainTitle(t).toLowerCase().replace(/s$/, '')).length - 1;
    const mentioned = pool
      .filter((t) => listLike(t, subject) && t !== listPage)
      .map((t) => ({ t, m: mentions(t) }))
      .filter((x) => x.m > 0)
      .sort((a, b) => b.m - a.m)
      .map((x) => x.t);
    if (listPage && (topWiki.includes(listPage) || !listLike(listPage, subject))) listPage = undefined;
    const lists = [...(listPage ? [listPage] : []), ...mentioned].slice(0, 2);
    const [pics, list] = await Promise.all([
      // Pictures from pages about specific things (a feature, a person) first; the subject's own pages add one at most.
      Promise.all(
        [...topWiki.filter((t) => !namesSubject(subject, mainTitle(t))), ...topWiki.filter((t) => namesSubject(subject, mainTitle(t)))]
          .slice(0, 3)
          .map((t) => timeout(wikiImages(wiki, t, `On the ${t} page`, namesSubject(subject, mainTitle(t)) ? 1 : 4, signal), 8000, [])),
      ),
      (async () => {
        for (const l of lists) {
          const g = await timeout(wikiGallery(wiki, l, subject, signal), 12000, undefined);
          if (g) return g;
        }
        return undefined;
      })(),
    ]);
    photos = pics.flat();
    gallery = list;
    if (gallery && listLabel && gallery.title === listPage) gallery.label = listLabel;
    // The search names a set of things ("gate keys", "weapons", "Horcruxes"): the wiki's category of them.
    const named = terms(query).filter((w) => !terms(subject).includes(w) && !GENERIC_ASK.has(w));
    // What the planner understood the search to be about ("celestial spirit keys") comes first.
    const sets = [...(given?.focus ?? []).slice(0, 3), ...(named.length ? [named.join(' ')] : [])];
    // A list the AI picked that shares no word with what was asked ("Demons" for "the colt and other weapons")
    // gives way to the wiki's category of the things the search names.
    const asked = new Set([...named, ...sets.flatMap(terms)]);
    const onPoint = (t: string) => terms(t).some((w) => asked.has(w) || asked.has(w.replace(/s$/, '')) || asked.has(`${w}s`));
    const aiList = gallery;
    if (aiList && named.length && !onPoint(aiList.title)) gallery = undefined;
    for (const what of sets) {
      if (gallery) break;
      const g = await timeout(categoryGallery(wiki, subject, what, signal), 7000, undefined);
      if (g) gallery = { title: g.title, url: g.url, items: g.items.slice(0, 40), label: g.label };
    }
    gallery ??= aiList;
    if (gallery) {
      const bare = (t: string) => t.replace(/\s*\(.*\)\s*$/, '');
      const stemOf = bare(gallery.title).toLowerCase().replace(/s$/, '');
      const owner = topWiki
        .map((t, i) => ({ t, m: (wikiTexts[i] ?? '').toLowerCase().split(stemOf).length - 1 }))
        .filter((x) => x.m > 0 && !namesSubject(subject, bare(x.t)) && bare(x.t) !== bare(gallery!.title))
        .sort((a, b) => b.m - a.m)[0];
      if (owner) gallery.about = bare(owner.t);
    }
  }
  const vocabulary = [...new Set([...salientTerms([...wikiTexts, ...reading.map((r) => r.text), ...scout.filter((s) => namesSubject(subject, s.title)).map((s) => `${s.title} ${s.snippet ?? ''}`)], subject, 24), ...(wiki ? terms(wiki.name).filter((w) => w.length >= 5 && !terms(subject).includes(w) && w !== 'wiki') : [])])];
  return { items, photos, gallery, reading, queries: [...queries, ...siteSearches], wiki: wiki?.name, vocabulary };
}

export function describeError(e: unknown) {
  return errMsg(e);
}
