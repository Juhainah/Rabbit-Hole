import type { SourceItem } from '../../shared/types';
import { enc, getJson, stripHtml } from '../http';
import type { SearchFn } from './types';
import { host } from './types';
import { webSearch } from './web';

// Fandom and art sources: anime and manga with their casts, fan art, and design boards.

/** AniList (anime and manga, no key): the show or book, and its main characters with their pictures. */
export const anilist: SearchFn = async (q, { limit, signal }) => {
  const query = `query ($q: String, $n: Int) {
    Page(perPage: $n) {
      media(search: $q, sort: [POPULARITY_DESC], isAdult: false) {
        id type format title { romaji english } description(asHtml: false) startDate { year month day }
        coverImage { large } siteUrl genres averageScore
        characters(sort: [ROLE, RELEVANCE], perPage: 8) { nodes { name { full } image { medium } siteUrl } }
      }
    }
  }`;
  const j = await getJson<any>('https://graphql.anilist.co', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { q, n: Math.min(limit, 6) } }),
  });
  const out: SourceItem[] = [];
  for (const m of j?.data?.Page?.media ?? []) {
    const title = m.title?.english || m.title?.romaji || 'Untitled';
    const d = m.startDate;
    const cast = (m.characters?.nodes ?? []).map((c: any) => c.name?.full).filter(Boolean).slice(0, 6);
    out.push({
      id: `anilist:${m.id}`,
      source: 'anilist',
      kind: 'media',
      title: `${title}${m.format ? ` (${String(m.format).replace(/_/g, ' ').toLowerCase()})` : ''}`,
      snippet: [stripHtml(m.description ?? '', 360), cast.length ? `Main characters: ${cast.join(', ')}.` : ''].filter(Boolean).join(' '),
      image: m.coverImage?.large,
      url: m.siteUrl,
      date: d?.year ? [d.year, d.month, d.day].filter(Boolean).map((x: number) => String(x).padStart(2, '0')).join('-') : undefined,
      meta: { ...(m.genres?.length ? { genres: m.genres.slice(0, 3).join(', ') } : {}), ...(m.averageScore ? { score: m.averageScore } : {}) },
    });
  }
  return out.slice(0, limit);
};

/** DeviantArt fan art (no key): its public RSS search. */
export const deviantart: SearchFn = async (q, { limit, signal }) => {
  const res = await fetch(`https://backend.deviantart.com/rss.xml?type=deviation&q=${enc(q)}`, { signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RabbitHole research)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const out: SourceItem[] = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const tag = (t: string) => item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`))?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
    const link = tag('link');
    const image = item.match(/<media:content[^>]+url="([^"]+)"[^>]*medium="image"/)?.[1] ?? item.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1];
    // Mature-rated art stays off the board, and so does art whose own title says it is racy (the feed rates much of it "nonadult").
    const about = decode(tag('media:description') ?? tag('description') ?? '');
    if (!link || !image || /<media:rating>\s*adult/i.test(item) || RACY.test(`${tag('title') ?? ''} ${tag('media:keywords') ?? ''} ${stripHtml(about, 600)}`)) continue;
    out.push({
      id: `deviantart:${link}`,
      source: 'deviantart',
      kind: 'image',
      title: stripHtml(tag('title') ?? 'Untitled', 120),
      snippet: stripHtml(about, 240) || 'Fan art on DeviantArt',
      url: link,
      image,
      author: stripHtml(tag('media:credit') ?? '', 60) || undefined,
      date: tag('pubDate') ? new Date(tag('pubDate')!).toISOString().slice(0, 10) : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
};

const RACY = /\b(nsfw|18\+|r-?18|lewd|ecchi|hentai|nude|nudity|naked|lingerie|bikini|swimsuit|underwear|boudoir|pin-?up|sexy|fetish|patreon|onlyfans|commission)\b/i;

/** The feed escapes its HTML (&lt;p&gt;); undo that before stripping tags. */
const decode = (t: string) =>
  t
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');

const DESIGN_SITES = ['pinterest.com', 'behance.net', 'artstation.com', 'dribbble.com'];

/** Pinterest, Behance, ArtStation and Dribbble: no public search, so one web search across all four. */
export const design: SearchFn = async (q, { limit, signal }) => {
  const items = await webSearch(`${q} (${DESIGN_SITES.map((s) => `site:${s}`).join(' OR ')})`, limit + 4, signal);
  return items
    .filter((it) => DESIGN_SITES.some((s) => host(it.url)?.endsWith(s)))
    .slice(0, limit)
    .map((it) => ({ ...it, id: `design:${it.url}`, source: 'design', kind: it.image ? ('image' as const) : it.kind, meta: { ...(it.meta ?? {}), site: host(it.url) ?? '' } }));
};
