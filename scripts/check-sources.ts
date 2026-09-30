import "dotenv/config";
import { SEARCHERS, searchSource } from '../server/sources/index';
import { SOURCES } from '../shared/sources';

const QUERIES: Record<string, string> = {
  wayback: 'example.com',
  places: 'Dyatlov Pass',
  nearby: 'Roswell, New Mexico',
  inaturalist: 'axolotl',
  oeis: '1,1,2,3,5,8,13',
  wiktionary: 'rabbit',
  urbandictionary: 'rabbit hole',
  conceptnet: 'rabbit hole',
  musicbrainz: 'Boards of Canada',
  atlasobscura: 'catacombs',
  fandom: 'backrooms',
  knowyourmeme: 'backrooms',
  gutenberg: 'dracula',
  sep: 'consciousness',
  damninteresting: 'shipwreck',
  futilitycloset: 'cipher',
  tvmaze: 'unsolved mysteries',
  fbi: 'bank',
  sec: 'uranium',
};

const ids = process.argv[2] ? process.argv[2].split(',') : Object.keys(SEARCHERS);
const missingMeta = Object.keys(SEARCHERS).filter((id) => !SOURCES.some((s) => s.id === id));
const missingImpl = SOURCES.filter((s) => !SEARCHERS[s.id]).map((s) => s.id);
console.log('no meta:', missingMeta.join(',') || '-', '| no impl:', missingImpl.join(',') || '-');

const results = await Promise.all(
  ids.map(async (id) => {
    const q = QUERIES[id] ?? 'Voynich manuscript';
    const t0 = Date.now();
    try {
      const items = await searchSource(id, q, { limit: 3 });
      const f = items[0];
      return `${id.padEnd(16)} OK  ${String(items.length).padStart(2)} ${String(Date.now() - t0).padStart(5)}ms  ${f ? `${f.title.slice(0, 50)} | img:${f.image ? 'y' : 'n'} url:${f.url ? 'y' : 'n'} snip:${(f.snippet ?? '').length}` : '(empty)'}`;
    } catch (e: any) {
      return `${id.padEnd(16)} ERR       ${String(Date.now() - t0).padStart(5)}ms  ${String(e?.message ?? e).slice(0, 120)}`;
    }
  }),
);
console.log(results.join('\n'));
process.exit(0);
