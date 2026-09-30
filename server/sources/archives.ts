import type { ItemKind, SourceItem } from '../../shared/types';
import { XMLParser } from 'fast-xml-parser';
import { enc, getJson, getText, stripHtml } from '../http';
import { webSearch } from './web';
import { arr, host, num, one, type SearchFn } from './types';

const IA_KIND: Record<string, ItemKind> = {
  texts: 'book',
  movies: 'video',
  audio: 'audio',
  etree: 'audio',
  image: 'image',
  software: 'code',
  data: 'dataset',
};

export const archive: SearchFn = async (q, { limit, signal }) => {
  const fields = ['identifier', 'title', 'description', 'mediatype', 'year', 'creator', 'downloads'];
  const url =
    `https://archive.org/advancedsearch.php?q=${enc(q)}` +
    fields.map((f) => `&fl[]=${f}`).join('') +
    `&rows=${limit}&output=json`;
  const j = await getJson(url, { signal });
  return (j.response?.docs ?? []).map((d: any) => {
    const kind = IA_KIND[d.mediatype] ?? 'record';
    const item: SourceItem = {
      id: `archive:${d.identifier}`,
      source: 'archive',
      kind,
      title: String(one(d.title) ?? d.identifier),
      snippet: stripHtml(String(one(d.description) ?? ''), 320),
      url: `https://archive.org/details/${d.identifier}`,
      image: `https://archive.org/services/img/${d.identifier}`,
      date: d.year ? String(d.year) : undefined,
      author: one(d.creator) ? String(one(d.creator)) : undefined,
      meta: { type: d.mediatype, downloads: num(d.downloads) ?? 0 },
    };
    if (kind === 'video' || kind === 'audio') item.media = { type: 'archive', src: d.identifier };
    return item;
  });
};

/** One Wayback snapshot per year for a URL or domain. */
export const wayback: SearchFn = async (q, { limit, signal }) => {
  const target = q.trim().replace(/^https?:\/\//, '');
  if (!/^[\w-]+(\.[\w-]+)+/.test(target)) return [];
  const j = await getJson<string[][]>(
    `https://web.archive.org/cdx/search/cdx?url=${enc(target)}&output=json&collapse=timestamp:4&fl=timestamp,original&filter=statuscode:200&limit=60`,
    { signal, timeout: 30000 },
  );
  const rows = j.slice(1);
  const step = Math.max(1, Math.ceil(rows.length / limit));
  return rows
    .filter((_, i) => i % step === 0 || i === rows.length - 1)
    .slice(-limit)
    .map(([ts, original]) => ({
      id: `wayback:${ts}`,
      source: 'wayback',
      kind: 'record' as const,
      title: `${host(`http://${target}`) ?? target} — ${ts.slice(0, 4)}`,
      snippet: `Archived snapshot of ${original} from ${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
      url: `https://web.archive.org/web/${ts}/${original}`,
      date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
    }));
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A site name inside text ("rotten.com", "www.geocities.com/area51"), without the www. */
export function siteIn(text: string): string | undefined {
  const m = text.toLowerCase().match(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|info|biz|co|io|tv|us|uk|ca|de|fr|ru|jp|au|nl|it|es|se|no|in|me|ly|am|to|cc))\b/);
  return m?.[1].replace(/^www\./, '');
}

/** "March 2001" → 200103, "2001-03" → 200103, "in 2003" → 2003. */
export function periodIn(text: string): string | undefined {
  const t = text.toLowerCase();
  const iso = t.match(/\b(19[89]\d|20[0-4]\d)[-/.](0[1-9]|1[0-2])\b/);
  if (iso) return iso[1] + iso[2];
  const named = t.match(new RegExp(`\\b(${MONTHS.map((m) => m.toLowerCase().slice(0, 3)).join('|')})[a-z]*\\.?\\s+(19[89]\\d|20[0-4]\\d)\\b`));
  if (named) return named[2] + String(MONTHS.findIndex((m) => m.toLowerCase().startsWith(named[1])) + 1).padStart(2, '0');
  const year = t.match(/\b(19[89]\d|20[0-4]\d)\b/)?.[1];
  if (year) return year;
  // A doubled zero is a typo, not the year 20001.
  const typo = t.match(/\b(19|20)0(\d{2})\b/);
  return typo ? typo[1] + typo[2] : undefined;
}

const periodLabel = (p: string) => (p.length === 6 ? `${MONTHS[Number(p.slice(4)) - 1]} ${p.slice(0, 4)}` : p);

/**
 * Pictures the Wayback Machine saved from a site. Asked for a month with none,
 * it widens to the year, then to any time, and says which period it found.
 */
export async function waybackImages(site: string, period: string | undefined, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  // A month with nothing widens to its year; a year you asked for is never swapped for another.
  const periods = period ? [period, ...(period.length === 6 ? [period.slice(0, 4)] : [])] : [''];
  for (const p of [...new Set(periods)]) {
    const range = p ? `&from=${p}&to=${p}` : '';
    const rows = await getJson<string[][]>(
      `https://web.archive.org/cdx/search/cdx?url=${enc(site)}&matchType=domain${range}&output=json&fl=timestamp,original,length&filter=statuscode:200&filter=mimetype:image/.*&collapse=urlkey&limit=300`,
      { signal, timeout: 25000 },
    ).catch(() => [] as string[][]);
    // Skip spacers, buttons and icons: real pictures are a few kilobytes at least.
    const pics = rows.slice(1).filter(([, original, length]) => Number(length) > 6000 && !/(spacer|pixel|blank|button|icon|logo|banner|bullet|arrow|counter)/i.test(original));
    if (!pics.length) continue;
    const step = Math.max(1, Math.floor(pics.length / limit));
    const when = p ? periodLabel(p) : 'the archive';
    return pics
      .filter((_, i) => i % step === 0)
      .slice(0, limit)
      .map(([ts, original]) => {
        const name = decodeURIComponent(original.split('/').pop() ?? 'image').replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ');
        return {
          id: `wayback-img:${ts}:${original}`,
          source: 'wayback',
          kind: 'image' as const,
          title: `${name} (${site}, ${ts.slice(0, 4)})`,
          snippet: `Image saved by the Wayback Machine from ${original.replace(/^https?:\/\//, '').replace(/:80\//, '/')} on ${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}${period && p !== period ? ` (nothing saved in ${periodLabel(period)}, so this is from ${when})` : ''}.`,
          url: `https://web.archive.org/web/${ts}/${original}`,
          image: `https://web.archive.org/web/${ts}im_/${original}`,
          date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
          meta: { site, period: when },
        };
      });
  }
  return [];
}

export const openlibrary: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://openlibrary.org/search.json?q=${enc(q)}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,subject,edition_count,ia,public_scan_b`,
    { signal },
  );
  return (j.docs ?? []).map((d: any) => ({
    id: `openlibrary:${d.key}`,
    source: 'openlibrary',
    kind: 'book' as const,
    title: d.title,
    snippet: (d.subject ?? []).slice(0, 6).join(' · '),
    author: d.author_name?.slice(0, 2).join(', '),
    date: d.first_publish_year ? String(d.first_publish_year) : undefined,
    image: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : undefined,
    url: `https://openlibrary.org${d.key}`,
    meta: {
      ...(d.edition_count ? { editions: d.edition_count } : {}),
      ...(d.ia?.length ? { scan: d.public_scan_b ? 'free full text' : 'borrowable' } : {}),
    },
  }));
};

const opds = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Project Gutenberg's own OPDS catalogue search. */
export const gutenberg: SearchFn = async (q, { limit, signal }) => {
  const text = await getText(`https://www.gutenberg.org/ebooks/search.opds/?query=${enc(q)}`, {
    signal,
    headers: { Accept: 'application/atom+xml' },
  });
  return arr(opds.parse(text)?.feed?.entry)
    .map((e: any) => {
      const book = arr(e.link).find((l: any) => /\/ebooks\/\d+/.test(l['@_href'] ?? ''))?.['@_href'];
      const id = String(book ?? e.id ?? '').match(/(\d+)(?:\.opds)?$/)?.[1];
      if (!id) return null;
      return {
        id: `gutenberg:${id}`,
        source: 'gutenberg',
        kind: 'book' as const,
        title: String(typeof e.title === 'object' ? e.title['#text'] : e.title),
        author: typeof e.content === 'object' ? undefined : stripHtml(String(e.content ?? ''), 80) || undefined,
        image: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
        url: `https://www.gutenberg.org/ebooks/${id}`,
      } satisfies SourceItem;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, limit);
};

export const europeana: SearchFn = async (q, { limit, signal }) => {
  const key = process.env.EUROPEANA_API_KEY || 'api2demo';
  const j = await getJson(
    `https://api.europeana.eu/record/v2/search.json?wskey=${key}&query=${enc(q)}&rows=${limit}&profile=standard`,
    { signal },
  );
  return (j.items ?? []).map((it: any) => ({
    id: `europeana:${it.id}`,
    source: 'europeana',
    kind: (it.type === 'IMAGE' ? 'image' : it.type === 'VIDEO' ? 'video' : it.type === 'SOUND' ? 'audio' : 'record') as ItemKind,
    title: one(it.title) ?? 'Untitled',
    snippet: stripHtml(one(it.dcDescription), 300),
    image: one(it.edmPreview),
    url: String(it.guid ?? '').split('?')[0] || `https://www.europeana.eu/item${it.id}`,
    date: one(it.year),
    author: one(it.dcCreator),
    meta: one(it.dataProvider) ? { from: String(one(it.dataProvider)) } : undefined,
  }));
};

export const ukarchives: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://discovery.nationalarchives.gov.uk/API/search/records?sps.searchQuery=${enc(q)}&sps.resultsPageSize=${limit}`,
    { signal, headers: { Accept: 'application/json' } },
  );
  return (j.records ?? []).map((r: any) => {
    const desc = stripHtml(r.description, 400);
    return {
      id: `ukarchives:${r.id}`,
      source: 'ukarchives',
      kind: 'record' as const,
      title: stripHtml(r.title, 120) || desc.slice(0, 90) || r.reference,
      snippet: desc,
      date: r.coveringDates,
      url: `https://discovery.nationalarchives.gov.uk/details/r/${r.id}`,
      meta: { ref: r.reference ?? '' },
    };
  });
};

const DECLASSIFIED_SITES = ['cia.gov/readingroom', 'vault.fbi.gov', 'nsarchive.gwu.edu'];

export const declassified: SearchFn = async (q, { limit, signal }) => {
  const batches = await Promise.allSettled(
    DECLASSIFIED_SITES.map((site) => webSearch(`${q} site:${site}`, Math.ceil(limit / 2) + 1, signal)),
  );
  const items = batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : []));
  if (!items.length && batches.every((b) => b.status === 'rejected')) throw (batches[0] as PromiseRejectedResult).reason;
  return items.slice(0, limit).map((it) => ({ ...it, id: `declassified:${it.url}`, source: 'declassified', kind: 'record' }));
};

export const smithsonian: SearchFn = async (q, { limit, signal }) => {
  const key = process.env.DATA_GOV_API_KEY || 'DEMO_KEY';
  const search = (query: string) => getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${enc(query)}&rows=${limit}&api_key=${key}`, { signal });
  // Objects with open-access pictures first (they make the best evidence), then books and archives.
  const [pictured, rest] = await Promise.allSettled([search(`${q} AND media_usage:"CC0"`), search(q)]);
  if (pictured.status === 'rejected' && rest.status === 'rejected') throw rest.reason;
  const seen = new Set<string>();
  const rows = [pictured, rest]
    .flatMap((b) => (b.status === 'fulfilled' ? (b.value.response?.rows ?? []) : []))
    .filter((r: any) => !seen.has(r.id) && seen.add(r.id));
  return rows.slice(0, limit * 2).map((r: any) => {
    const c = r.content ?? {};
    const d = c.descriptiveNonRepeating ?? {};
    return {
      id: `smithsonian:${r.id}`,
      source: 'smithsonian',
      kind: 'record' as const,
      title: r.title ?? d.title?.content ?? 'Untitled',
      snippet: stripHtml(c.freetext?.notes?.[0]?.content ?? c.freetext?.objectType?.[0]?.content, 300),
      image: d.online_media?.media?.[0]?.thumbnail,
      // Some records have no page of their own; a collection search for the title is the next best thing.
      url: d.record_link ?? d.guid ?? `https://collections.si.edu/search/results.htm?q=${enc(r.title ?? q)}`,
      date: c.indexedStructured?.date?.[0],
      meta: d.data_source ? { from: d.data_source } : undefined,
    };
  });
};

export const met: SearchFn = async (q, { limit, signal }) => {
  const s = await getJson(
    `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${enc(q)}&hasImages=true`,
    { signal },
  );
  const ids: number[] = (s.objectIDs ?? []).slice(0, limit);
  const objs = await Promise.allSettled(
    ids.map((id) => getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { signal })),
  );
  return objs
    .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    .map((o: any) => ({
      id: `met:${o.objectID}`,
      source: 'met',
      kind: 'artwork' as const,
      title: o.title || 'Untitled',
      snippet: [o.objectName, o.culture, o.medium].filter(Boolean).join(' · '),
      image: o.primaryImageSmall || undefined,
      url: o.objectURL,
      date: o.objectDate,
      author: o.artistDisplayName || undefined,
    }));
};

export const artic: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.artic.edu/api/v1/artworks/search?q=${enc(q)}&limit=${limit}&fields=id,title,image_id,date_display,artist_display,short_description,medium_display`,
    { signal },
  );
  const iiif = j.config?.iiif_url ?? 'https://www.artic.edu/iiif/2';
  return (j.data ?? []).map((a: any) => ({
    id: `artic:${a.id}`,
    source: 'artic',
    kind: 'artwork' as const,
    title: a.title,
    snippet: stripHtml(a.short_description, 300) || a.medium_display,
    image: a.image_id ? `${iiif}/${a.image_id}/full/400,/0/default.jpg` : undefined,
    url: `https://www.artic.edu/artworks/${a.id}`,
    date: a.date_display,
    author: a.artist_display?.split('\n')[0],
  }));
};

export const cleveland: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://openaccess-api.clevelandart.org/api/artworks/?q=${enc(q)}&limit=${limit}&has_image=1`,
    { signal },
  );
  return (j.data ?? []).map((a: any) => ({
    id: `cleveland:${a.id}`,
    source: 'cleveland',
    kind: 'artwork' as const,
    title: a.title,
    snippet: stripHtml(a.description ?? a.tombstone, 300),
    image: a.images?.web?.url,
    url: a.url,
    date: a.creation_date,
    author: a.creators?.[0]?.description,
  }));
};

export const vam: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.vam.ac.uk/v2/objects/search?q=${enc(q)}&page_size=${limit}&images_exist=true`,
    { signal },
  );
  return (j.records ?? []).map((r: any) => ({
    id: `vam:${r.systemNumber}`,
    source: 'vam',
    kind: 'artwork' as const,
    title: r._primaryTitle || r.objectType,
    snippet: [r.objectType, r._primaryPlace].filter(Boolean).join(' · '),
    image: r._images?._primary_thumbnail?.replace('!100,100', '!400,400'),
    url: `https://collections.vam.ac.uk/item/${r.systemNumber}/`,
    date: r._primaryDate,
    author: r._primaryMaker?.name,
  }));
};

export const wellcome: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.wellcomecollection.org/catalogue/v2/works?query=${enc(q)}&pageSize=${limit}&include=production,contributors`,
    { signal },
  );
  return (j.results ?? []).map((w: any) => ({
    id: `wellcome:${w.id}`,
    source: 'wellcome',
    kind: (w.workType?.label?.toLowerCase().includes('picture') ? 'image' : 'record') as ItemKind,
    title: w.title,
    snippet: stripHtml(w.description, 300) || w.workType?.label,
    image: w.thumbnail?.url?.replace(/\/info\.json$/, '/full/400,/0/default.jpg'),
    url: `https://wellcomecollection.org/works/${w.id}`,
    date: arr(w.production)[0]?.dates?.[0]?.label,
    author: arr(w.contributors)[0]?.agent?.label,
  }));
};

/** Internet Archive recordings (radio, oral history, speeches) or films (newsreels, documentaries). */
export async function archiveMedia(q: string, kind: 'audio' | 'movies', limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const type = kind === 'audio' ? '(audio OR etree)' : 'movies';
  const fields = ['identifier', 'title', 'description', 'mediatype', 'year', 'creator', 'downloads'];
  const url =
    `https://archive.org/advancedsearch.php?q=${enc(`(${q}) AND mediatype:${type} AND NOT collection:(podcasts OR audio_podcast)`)}` +
    fields.map((f) => `&fl[]=${f}`).join('') +
    `&rows=${limit}&output=json`;
  const j = await getJson(url, { signal, timeout: 15000 });
  return (j.response?.docs ?? []).map((d: any) => ({
    id: `archive:${d.identifier}`,
    source: 'archive',
    kind: kind === 'audio' ? ('audio' as const) : ('video' as const),
    title: String(one(d.title) ?? d.identifier),
    snippet: stripHtml(String(one(d.description) ?? ''), 280),
    url: `https://archive.org/details/${d.identifier}`,
    image: `https://archive.org/services/img/${d.identifier}`,
    date: d.year ? String(d.year) : undefined,
    author: one(d.creator) ? String(one(d.creator)) : undefined,
    media: { type: 'archive' as const, src: d.identifier },
    meta: { type: kind === 'audio' ? 'recording' : 'film' },
  }));
}
