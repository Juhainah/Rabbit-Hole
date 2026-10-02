import type { SourceItem } from '../../shared/types';
import { normalizeDate } from '../http';
import * as academic from './academic';
import * as archives from './archives';
import * as community from './community';
import * as knowledge from './knowledge';
import * as media from './media';
import * as places from './places';
import * as records from './records';
import type { SearchFn, SearchOpts } from './types';
import * as web from './web';

export const SEARCHERS: Record<string, SearchFn> = {
  wikipedia: knowledge.wikipedia,
  wikidata: knowledge.wikidata,
  wikiquote: knowledge.wikiquote,
  wiktionary: knowledge.wiktionary,
  wikisource: records.wikisource,
  commons: knowledge.commons,
  urbandictionary: records.urbandictionary,

  archive: archives.archive,
  wayback: archives.wayback,
  openlibrary: archives.openlibrary,
  gutenberg: archives.gutenberg,
  europeana: archives.europeana,
  ukarchives: archives.ukarchives,
  declassified: archives.declassified,
  aleph: records.aleph,

  smithsonian: archives.smithsonian,
  met: archives.met,
  artic: archives.artic,
  cleveland: archives.cleveland,
  vam: archives.vam,
  wellcome: archives.wellcome,

  openalex: academic.openalex,
  arxiv: academic.arxiv,
  crossref: academic.crossref,
  europepmc: academic.europepmc,
  semanticscholar: academic.semanticscholar,
  zenodo: academic.zenodo,
  oeis: academic.oeis,

  reddit: community.reddit,
  hackernews: community.hackernews,
  lemmy: community.lemmy,
  stackexchange: community.stackexchange,

  googlenews: media.googlenews,
  gdelt: media.gdelt,

  web: web.web,
  wiby: web.wiby,
  github: web.github,
  atlasobscura: web.atlasobscura,
  fandom: web.fandom,
  damninteresting: web.damninteresting,
  futilitycloset: web.futilitycloset,
  sep: web.sep,
  ...web.siteSearchers,

  youtube: media.youtube,
  dailymotion: media.dailymotion,
  podcasts: media.podcasts,
  openverse: media.openverse,
  nasa: media.nasa,
  tvmaze: media.tvmaze,
  musicbrainz: media.musicbrainz,

  places: places.places,
  nearby: knowledge.nearby,
  inaturalist: places.inaturalist,

  courtlistener: records.courtlistener,
  fedregister: records.fedregister,
  sec: records.sec,
  fbi: records.fbi,
};

/** Sources that only work once the owner adds a key to .env. */
const NEEDS_KEY: Record<string, string> = { aleph: "ALEPH_API_KEY" };

export const availableSources = () =>
  Object.keys(SEARCHERS).filter((id) => !NEEDS_KEY[id] || !!process.env[NEEDS_KEY[id]]?.trim());

const cache = new Map<string, { at: number; items: SourceItem[] }>();
const TTL = 20 * 60_000;

export async function searchSource(id: string, q: string, opts: SearchOpts): Promise<SourceItem[]> {
  const fn = SEARCHERS[id];
  if (!fn) throw new Error(`Unknown source "${id}"`);
  const key = `${id}|${q.trim().toLowerCase()}|${opts.limit}|${opts.subject ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const items = (await fn(q.trim(), opts))
    .filter((i) => i && i.title)
    .map((i) => ({ ...i, title: String(i.title).trim(), date: normalizeDate(i.date) }))
    .slice(0, opts.limit);
  cache.set(key, { at: Date.now(), items });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return items;
}
