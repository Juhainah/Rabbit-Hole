import type { EntityEnrichment, Primary, SourceItem } from '../../shared/types';
import { namesSubject } from '../relevance';
import { decodeEntities, enc, getJson, stripHtml } from '../http';
import { geocode } from './places';
import type { SearchFn } from './types';

type Params = Record<string, string | number>;

const mw = (base: string, params: Params) =>
  `${base}?${new URLSearchParams({
    format: 'json',
    formatversion: '2',
    origin: '*',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })}`;

const WP = 'https://en.wikipedia.org/w/api.php';
const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${enc(title.replace(/ /g, '_'))}`;

interface WpPage {
  pageid: number;
  title: string;
  index?: number;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
  coordinates?: { lat: number; lon: number }[];
  missing?: boolean;
}

const pagesOf = (j: any): WpPage[] =>
  ((j?.query?.pages ?? []) as WpPage[]).filter((p) => !p.missing).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

export const wikipedia: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    mw(WP, {
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: limit,
      prop: 'pageimages|extracts|coordinates|info',
      inprop: 'url',
      exintro: 1,
      explaintext: 1,
      exsentences: 3,
      exlimit: 'max',
      piprop: 'thumbnail',
      pithumbsize: 330,
      pilimit: 'max',
      colimit: 'max',
    }),
    { signal },
  );
  return pagesOf(j).map((p) => ({
    id: `wikipedia:${p.pageid}`,
    source: 'wikipedia',
    kind: 'article',
    title: p.title,
    snippet: stripHtml(p.extract, 420),
    url: p.fullurl ?? wikiUrl(p.title),
    image: p.thumbnail?.source,
    lat: p.coordinates?.[0]?.lat,
    lon: p.coordinates?.[0]?.lon,
  }));
};

const primaryCache = new Map<string, { at: number; p: Primary | null }>();

/** The main article for a topic: long plain-text extract plus "more like this" titles for tangents. */
export async function wikiPrimary(topic: string, signal?: AbortSignal): Promise<Primary | null> {
  const key = topic.trim().toLowerCase();
  const hit = primaryCache.get(key);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.p;
  const p = await fetchPrimary(topic, signal);
  primaryCache.set(key, { at: Date.now(), p });
  return p;
}

async function fetchPrimary(topic: string, signal?: AbortSignal): Promise<Primary | null> {
  const j = await getJson(
    mw(WP, {
      action: 'query',
      generator: 'search',
      gsrsearch: topic,
      gsrlimit: 1,
      prop: 'extracts|pageimages|coordinates|info',
      inprop: 'url',
      explaintext: 1,
      exsectionformat: 'plain',
      piprop: 'thumbnail',
      pithumbsize: 960,
      redirects: 1,
    }),
    { signal },
  );
  const p = pagesOf(j)[0];
  if (!p) return null;
  const rel = await getJson(
    mw(WP, { action: 'query', list: 'search', srsearch: `morelike:${p.title}`, srlimit: 12, srprop: '' }),
    { signal },
  ).catch(() => null);
  return {
    title: p.title,
    extract: (p.extract ?? '').slice(0, 7000),
    url: p.fullurl ?? wikiUrl(p.title),
    image: p.thumbnail?.source,
    lat: p.coordinates?.[0]?.lat,
    lon: p.coordinates?.[0]?.lon,
    related: ((rel?.query?.search ?? []) as { title: string }[]).map((s) => s.title),
    source: 'wikipedia',
  };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);

const enrichCache = new Map<string, WpPage | null>();

/**
 * Is a search hit really the page for this name? Every word of the name must
 * appear in the page's title or opening lines, so "Asteroid 2794 Kulik" doesn't
 * get Leonid Kulik's page just for sharing a surname.
 */
function sameSubject(name: string, p: WpPage) {
  const need = words(name).filter((w) => w !== 'the' && w !== 'and');
  const title = new Set(words(p.title));
  if (!need.length) return true;
  if (!need.some((w) => title.has(w))) return false;
  const seen = new Set(words(`${p.title} ${stripHtml(p.extract ?? '', 400)}`));
  const hits = need.filter((w) => seen.has(w)).length;
  return hits === need.length || (need.length >= 4 && hits >= need.length - 1);
}
const PAGE_PROPS = {
  prop: 'pageimages|coordinates|info|extracts',
  inprop: 'url',
  exintro: 1,
  explaintext: 1,
  exsentences: 2,
  exlimit: 'max',
  piprop: 'thumbnail',
  pithumbsize: 330,
  pilimit: 'max',
  colimit: 'max',
};

/**
 * Photos, links and coordinates for entities the AI found. One batched exact-title
 * lookup covers most of them; only the leftovers fall back to a search each.
 */
export async function enrichEntities(
  entities: { name: string; type: string; place?: string; fictional?: boolean }[],
  signal?: AbortSignal,
  /** The case's subject: an idea or a thing ("Recipe", "Oven") only gets an article that is about it in this case. */
  about?: string,
): Promise<Record<string, EntityEnrichment>> {
  const out: Record<string, EntityEnrichment> = {};
  const found = new Map<string, WpPage>();
  const todo = entities.filter((e) => {
    const hit = enrichCache.get(e.name.toLowerCase());
    if (hit) found.set(e.name, hit);
    return hit === undefined;
  });

  if (todo.length) {
    try {
      const j = await getJson(mw(WP, { action: 'query', titles: todo.map((e) => e.name).join('|'), redirects: 1, ...PAGE_PROPS }), { signal, timeout: 12000 });
      // Map requested names through Wikipedia's normalisation and redirects to the final page.
      const rename = new Map<string, string>();
      for (const r of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])] as { from: string; to: string }[]) rename.set(r.from, r.to);
      const byTitle = new Map((pagesOf(j) as WpPage[]).map((p) => [p.title, p]));
      for (const e of todo) {
        let t = e.name;
        for (let i = 0; i < 3 && rename.has(t); i++) t = rename.get(t)!;
        const p = byTitle.get(t);
        if (p) found.set(e.name, p);
      }
    } catch {
      /* fall through to per-name search */
    }
    // Names Wikipedia doesn't know exactly get one search each, a few at a time.
    const leftovers = todo.filter((e) => !found.has(e.name)).slice(0, 6);
    await Promise.all(
      leftovers.map(async (e) => {
        try {
          const j = await getJson(mw(WP, { action: 'query', generator: 'search', gsrsearch: e.name, gsrlimit: 1, ...PAGE_PROPS }), { signal, timeout: 10000 });
          const p = pagesOf(j)[0];
          if (p && sameSubject(e.name, p)) found.set(e.name, p);
        } catch {
          /* best effort */
        }
      }),
    );
    for (const e of todo) enrichCache.set(e.name.toLowerCase(), found.get(e.name) ?? null);
  }

  for (const e of entities) {
    const p = found.get(e.name);
    if (!p) continue;
    // An invented character or place is never a real one with the same name (a real town for a game's country).
    if (e.fictional) continue;
    // Wikipedia's general article on a common idea or object (what a recipe is, the history of ovens) is not
    // evidence about the case: the card keeps the case's own description instead.
    if ((e.type === 'concept' || e.type === 'object') && about && !namesSubject(about, `${p.title} ${stripHtml(p.extract ?? '', 600)}`)) continue;
    const geo = e.type === 'place' || e.type === 'event';
    out[e.name] = {
      image: p.thumbnail?.source,
      url: p.fullurl,
      extract: stripHtml(p.extract, 300),
      lat: geo ? p.coordinates?.[0]?.lat : undefined,
      lon: geo ? p.coordinates?.[0]?.lon : undefined,
    };
  }
  // Places Wikipedia couldn't locate go to OpenStreetMap (throttled to 1/s, so cap it).
  const missing = entities.filter((e) => e.type === 'place' && !e.fictional && out[e.name]?.lat == null).slice(0, 5);
  for (const e of missing) {
    const g = await geocode(e.place || e.name, signal).catch(() => null);
    if (g) out[e.name] = { ...out[e.name], lat: g.lat, lon: g.lon };
  }
  return out;
}

export const wikidata: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q)}&language=en&uselang=en&format=json&limit=${limit}&origin=*`,
    { signal },
  );
  return (j.search ?? []).map((s: any) => ({
    id: `wikidata:${s.id}`,
    source: 'wikidata',
    kind: 'entity',
    title: s.display?.label?.value ?? s.label ?? s.id,
    snippet: s.display?.description?.value ?? s.description,
    url: `https://www.wikidata.org/wiki/${s.id}`,
    meta: { id: s.id },
  }));
};

export const wikiquote: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    mw('https://en.wikiquote.org/w/api.php', { action: 'query', list: 'search', srsearch: q, srlimit: limit }),
    { signal },
  );
  return (j.query?.search ?? []).map((s: any) => ({
    id: `wikiquote:${s.pageid}`,
    source: 'wikiquote',
    kind: 'quote',
    title: s.title,
    snippet: stripHtml(s.snippet, 300),
    url: `https://en.wikiquote.org/wiki/${enc(s.title.replace(/ /g, '_'))}`,
  }));
};

export const wiktionary: SearchFn = async (q, { limit, signal }) => {
  const term = q.trim().split(/\s+/).slice(0, 3).join('_');
  const fetchDef = (t: string) => getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${enc(t)}`, { signal });
  const j = await fetchDef(term).catch(() => fetchDef(term.toLowerCase()));
  const defs: any[] = j.en ?? (Object.values(j)[0] as any[]) ?? [];
  return defs.slice(0, limit).map((d, i) => ({
    id: `wiktionary:${term}:${i}`,
    source: 'wiktionary',
    kind: 'definition',
    title: `${term.replace(/_/g, ' ')} (${d.partOfSpeech})`,
    snippet: stripHtml(
      (d.definitions ?? [])
        .map((x: any) => x.definition)
        .filter(Boolean)
        .slice(0, 3)
        .join(' · '),
      400,
    ),
    url: `https://en.wiktionary.org/wiki/${enc(term)}`,
  }));
};

export const commons: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    mw('https://commons.wikimedia.org/w/api.php', {
      action: 'query',
      generator: 'search',
      gsrsearch: `${q} filetype:bitmap`,
      gsrnamespace: 6,
      gsrlimit: limit,
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: 500,
      iiextmetadatafilter: 'ImageDescription|Artist|DateTimeOriginal|LicenseShortName',
    }),
    { signal },
  );
  return pagesOf(j)
    .map((p: any): SourceItem | null => {
      const ii = p.imageinfo?.[0];
      if (!ii) return null;
      const md = ii.extmetadata ?? {};
      return {
        id: `commons:${p.pageid}`,
        source: 'commons',
        kind: 'image',
        title: p.title.replace(/^File:/, '').replace(/\.\w+$/, '').replace(/_/g, ' '),
        snippet: stripHtml(md.ImageDescription?.value, 240),
        image: ii.thumburl ?? ii.url,
        url: ii.descriptionurl,
        date: stripHtml(md.DateTimeOriginal?.value, 20) || undefined,
        author: stripHtml(md.Artist?.value, 60) || undefined,
        meta: md.LicenseShortName?.value ? { license: stripHtml(md.LicenseShortName.value, 30) } : undefined,
      };
    })
    .filter((x): x is SourceItem => !!x);
};

export const nearby: SearchFn = async (q, { limit, signal }) => {
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  const center = m ? { lat: +m[1], lon: +m[2] } : await geocode(q, signal);
  if (!center) return [];
  const j = await getJson(
    mw(WP, {
      action: 'query',
      generator: 'geosearch',
      ggscoord: `${center.lat}|${center.lon}`,
      ggsradius: 10000,
      ggslimit: limit,
      prop: 'pageimages|extracts|coordinates|info',
      inprop: 'url',
      exintro: 1,
      explaintext: 1,
      exsentences: 2,
      exlimit: 'max',
      piprop: 'thumbnail',
      pithumbsize: 330,
      pilimit: 'max',
    }),
    { signal },
  );
  return pagesOf(j).map((p) => ({
    id: `nearby:${p.pageid}`,
    source: 'nearby',
    kind: 'place',
    title: p.title,
    snippet: stripHtml(p.extract, 300),
    url: p.fullurl,
    image: p.thumbnail?.source,
    lat: p.coordinates?.[0]?.lat,
    lon: p.coordinates?.[0]?.lon,
  }));
};

// Wikipedia's hand-picked "Unusual articles" list: far better rabbit holes than a truly random page.
let unusual: { at: number; titles: string[] } | null = null;
/** The list is tables of [article | why it's odd]; only first-column links are real entries. */
function firstColumnTitles(html: string): string[] {
  const out: string[] = [];
  for (const row of html.split(/<tr[\s>]/).slice(1)) {
    const cell = row.split(/<\/td>/)[0];
    const m = cell.match(/<a href="\/wiki\/([^"#]+)"[^>]*title="([^"]+)"/);
    if (m && !m[1].includes(':')) out.push(decodeEntities(m[2]));
  }
  return out;
}

async function unusualTitles(): Promise<string[]> {
  if (unusual && Date.now() - unusual.at < 24 * 3600_000) return unusual.titles;
  const page = (name: string) =>
    getJson(mw(WP, { action: 'parse', page: name, prop: 'text' }), { timeout: 20000 }).then((j) => String(j.parse?.text ?? ''));
  const main = await page('Wikipedia:Unusual articles');
  const titles = firstColumnTitles(main);
  // The list is split across themed subpages; read a few of them too.
  const subs = [...new Set([...main.matchAll(/href="\/wiki\/(Wikipedia:Unusual_articles\/[^"#]+)"/g)].map((m) => decodeURIComponent(m[1]).replace(/_/g, ' ')))];
  for (const s of subs.sort(() => Math.random() - 0.5).slice(0, 4)) titles.push(...firstColumnTitles(await page(s).catch(() => '')));
  if (!titles.length) throw new Error('unusual articles list unavailable');
  // It's the welcome screen: keep the crude ones for people who go looking.
  const polite = titles.filter((t) => !/fuck|shit|cunt|porn|penis|vagina|sex|nude|anal\b/i.test(t));
  unusual = { at: Date.now(), titles: [...new Set(polite)] };
  return unusual.titles;
}

/** Unusual-article picks and "on this day" events for the landing screen. */
export async function inspiration() {
  const picks = await unusualTitles()
    .then((all) => [...all].sort(() => Math.random() - 0.5).slice(0, 8))
    .catch(() => [] as string[]);
  const [random, otd] = await Promise.all([
    getJson(
      mw(WP, {
        action: 'query',
        ...(picks.length ? { titles: picks.join('|') } : { generator: 'random', grnnamespace: 0, grnlimit: 8 }),
        prop: 'pageimages|extracts|info',
        inprop: 'url',
        exintro: 1,
        explaintext: 1,
        exsentences: 1,
        exlimit: 'max',
        piprop: 'thumbnail',
        pithumbsize: 330,
        redirects: 1,
      }),
    ).catch(() => null),
    (() => {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return getJson(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/${mm}/${dd}`).catch(() => null);
    })(),
  ]);
  return {
    random: pagesOf(random).map((p) => ({ title: p.title, snippet: stripHtml(p.extract, 160), image: p.thumbnail?.source })),
    onThisDay: ((otd?.selected ?? []) as any[]).slice(0, 8).map((e) => ({
      year: e.year as number,
      text: e.text as string,
      title: (e.pages?.[0]?.titles?.normalized as string) ?? '',
      image: e.pages?.[0]?.thumbnail?.source as string | undefined,
    })),
  };
}

/**
 * The pictures in a Wikipedia article (the crime scene, the people, the poster, the place), with what
 * each shows from its description: real, checked photos of the case, without any image search.
 */
/** Decoration and data graphics, not pictures of the case. */
const JUNK_PICTURE = /\b(icon|logo|flag|symbol|signature|stub|question book|commons logo|padlock|portal|ambox|crystal|nuvola|disambig|map of|location map|locator|blank|chart|graph|diagram|viewership|ratings|statistics|size comparison|comparison of|timeline of|coat of arms|anser|species)\b/i;

export async function wikiArticleImages(title: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const j = await getJson(
    mw(WP, { action: 'query', generator: 'images', titles: title, gimlimit: 40, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: 640, iiextmetadatafilter: 'ImageDescription|ObjectName|DateTimeOriginal', redirects: 1 }),
    { signal, timeout: 12000 },
  ).catch(() => null);
  const pages = (j?.query?.pages ? Object.values(j.query.pages) : []) as any[];
  return pages
    .map((p) => ({ p, ii: p.imageinfo?.[0] }))
    .filter(({ p, ii }) => {
      if (!ii?.thumburl || !/^image\/(jpeg|png|webp)/.test(ii.mime ?? '')) return false;
      if ((ii.width ?? 0) < 240 || (ii.height ?? 0) < 180) return false;
      // Icons, flags, logos, maps of whole regions, charts and signatures are decoration, not evidence.
      const said = String(p.imageinfo?.[0]?.extmetadata?.ImageDescription?.value ?? '');
      return !JUNK_PICTURE.test(`${String(p.title).replace(/[_-]/g, ' ')} ${stripHtml(said, 300)}`);
    })
    .slice(0, limit)
    .map(({ p, ii }) => {
      const meta = ii.extmetadata ?? {};
      const said = stripHtml(String(meta.ImageDescription?.value ?? meta.ObjectName?.value ?? ''), 200);
      const name = String(p.title).replace(/^File:/, '').replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
      const date = String(meta.DateTimeOriginal?.value ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1];
      return {
        id: `wp-img:${p.title}`,
        source: 'commons',
        kind: 'image' as const,
        title: said && said.length <= 90 ? said : name,
        snippet: said || `A picture from the Wikipedia article on ${title}`,
        url: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title))}`,
        image: ii.thumburl,
        date,
      };
    });
}
