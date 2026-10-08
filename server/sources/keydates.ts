import { enc, getJson } from '../http';

// The dates that matter in a subject's story, from Wikidata (the database behind Wikipedia's infoboxes):
// when it was made, released, first aired, won awards, changed hands, ended. These are checked facts,
// so the timeline is built from them first, never from when someone posted a review of it.

export interface KeyDate {
  date: string;
  event: string;
}

const UA = { 'User-Agent': 'RabbitHole/1.0 (research board)' };

/** Wikidata time ("+1983-05-00T00:00:00Z", precision 9 = year, 10 = month, 11 = day) → "1983", "1983-05", "1983-05-12". */
function wdDate(v: any): string | undefined {
  const t = String(v?.time ?? '');
  const m = t.match(/^([+-])(\d{1,16})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const year = Number(m[2]) * (m[1] === '-' ? -1 : 1);
  const p = Number(v?.precision ?? 9);
  if (p < 9) return undefined;
  const y = year < 0 ? String(year) : String(year).padStart(4, '0');
  if (p === 9 || m[3] === '00') return y;
  if (p === 10 || m[4] === '00') return `${y}-${m[3]}`;
  return `${y}-${m[3]}-${m[4]}`;
}

type Claim = { mainsnak?: { datavalue?: { value?: any } }; qualifiers?: Record<string, { datavalue?: { value?: any } }[]> };

/** What each dated property means, worded for a work, a group, an event or a person. */
const PROPS: [string, (what: string) => string][] = [
  ['P571', (k) => (k === 'org' ? 'Founded' : 'Created')],
  ['P577', () => 'Released'],
  ['P1191', () => 'First performed'],
  ['P580', (k) => (k === 'tv' ? 'First aired' : 'Began')],
  ['P582', (k) => (k === 'tv' ? 'Last aired' : 'Ended')],
  ['P585', () => 'Took place'],
  ['P576', (k) => (k === 'org' ? 'Dissolved' : 'Ended')],
  ['P569', () => 'Born'],
  ['P570', () => 'Died'],
  ['P5204', () => 'Commercially released'],
];

/** The Wikidata item behind a Wikipedia article. */
async function itemFor(title: string, signal?: AbortSignal): Promise<string | undefined> {
  const j = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&titles=${enc(title)}`, { signal, timeout: 8000 });
  return j?.query?.pages?.[0]?.pageprops?.wikibase_item;
}

async function labels(ids: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 45) {
    const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&props=labels&languages=en&format=json&ids=${ids.slice(i, i + 45).join('|')}`, { signal, timeout: 8000, headers: UA }).catch(() => null);
    for (const [id, e] of Object.entries((j?.entities ?? {}) as Record<string, any>)) if (e?.labels?.en?.value) out.set(id, e.labels.en.value);
  }
  return out;
}

/** The subject's key dates, oldest first (at most 14). Empty when Wikidata has none. */
export async function keyDates(articleTitle: string, signal?: AbortSignal): Promise<KeyDate[]> {
  const qid = await itemFor(articleTitle, signal).catch(() => undefined);
  if (!qid) return [];
  const j = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { signal, timeout: 10000, headers: UA }).catch(() => null);
  const claims = (j?.entities?.[qid]?.claims ?? {}) as Record<string, Claim[]>;
  const kinds = (claims.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean) as string[];
  // Television series and seasons, organisations and companies read differently ("First aired", "Founded").
  const kind = kinds.some((k) => ['Q5398426', 'Q3464665', 'Q1366112', 'Q21191270', 'Q117467246'].includes(k))
    ? 'tv'
    : kinds.some((k) => ['Q43229', 'Q4830453', 'Q783794', 'Q215380', 'Q891723', 'Q6881511', 'Q210167'].includes(k))
      ? 'org'
      : 'other';
  const want = new Set<string>();
  const raw: { date: string; label: (l: Map<string, string>) => string }[] = [];
  for (const [p, word] of PROPS) {
    for (const c of (claims[p] ?? []).slice(0, 4)) {
      const date = wdDate(c.mainsnak?.datavalue?.value);
      if (!date) continue;
      // "Released … on iOS", "… in Japan": the platform or place it came out on.
      const where = [...(c.qualifiers?.P400 ?? []), ...(c.qualifiers?.P291 ?? [])].map((q) => q.datavalue?.value?.id).filter(Boolean) as string[];
      where.forEach((w) => want.add(w));
      raw.push({ date, label: (l) => `${word(kind)}${where.length ? ` (${where.map((w) => l.get(w)).filter(Boolean).join(', ')})` : ''}` });
    }
  }
  // Owners with when they took over; the first few awards won (one a year), never the long list of nominations.
  const awardYears = new Set<string>();
  for (const [p, verb, max] of [['P127', 'Owned by', 3], ['P166', 'Won', 3]] as const) {
    let n = 0;
    for (const c of claims[p] ?? []) {
      if (n >= max) break;
      const id = c.mainsnak?.datavalue?.value?.id as string | undefined;
      const date = wdDate((c.qualifiers?.P585 ?? c.qualifiers?.P580 ?? [])[0]?.datavalue?.value);
      if (!id || !date) continue;
      if (p === 'P166' && awardYears.has(date.slice(0, 4))) continue;
      awardYears.add(date.slice(0, 4));
      want.add(id);
      n++;
      raw.push({ date, label: (l) => (l.get(id) ? `${verb} ${l.get(id)}` : '') });
    }
  }
  const names = await labels([...want], signal);
  const seen = new Set<string>();
  return raw
    .map((r) => ({ date: r.date, event: r.label(names) }))
    .filter((r) => r.event && !seen.has(`${r.date}|${r.event}`) && !!seen.add(`${r.date}|${r.event}`))
    .sort((a, b) => Number(a.date.slice(0, a.date.startsWith('-') ? 6 : 4)) - Number(b.date.slice(0, b.date.startsWith('-') ? 6 : 4)) || a.date.localeCompare(b.date))
    .slice(0, 14);
}
