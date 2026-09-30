// Measures how accurate the relevance filter is:
//   npx tsx scripts/eval-relevance.ts            (reuse cached results + judgments)
//   npx tsx scripts/eval-relevance.ts --rejudge  (ask the judge again)
//   npx tsx scripts/eval-relevance.ts --refresh  (search again, then judge)
// Real search results are labelled by an AI judge (in small batches, so it reads
// each one), then the board's keep/drop decisions are scored against the labels.
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { SourceItem } from '../shared/types';
import { parseJsonLoose } from '../server/json';
import { completeWithFallback, resolveProviders } from '../server/llm';
import { rankRelevant, relevanceFilter } from '../server/relevance';
import { searchSource } from '../server/sources';
import { wikiPrimary } from '../server/sources/knowledge';

const TOPICS = [
  'Dyatlov Pass incident',
  'Liam Payne death',
  'Numbers stations',
  'Apollo 11 moon landing',
  'The Mary Celeste',
  'Tunguska event',
  'Voynich manuscript',
  'Roswell incident',
];
const SOURCES = ['wikipedia', 'commons', 'archive', 'openlibrary', 'openalex', 'reddit', 'hackernews', 'googlenews', 'web', 'youtube', 'atlasobscura'];
const ITEMS = 'scripts/.eval-items.json';
const JUDGED = 'scripts/.eval-judged.json';
const PER = 3;

type Row = { topic: string; primary?: string; extract?: string; items: SourceItem[] };

async function collect(): Promise<Row[]> {
  if (existsSync(ITEMS) && !process.argv.includes('--refresh')) {
    const rows: Row[] = JSON.parse(readFileSync(ITEMS, 'utf8'));
    // Older caches predate context checks: add each topic's main-article text once.
    if (rows.some((r) => r.extract === undefined)) {
      for (const r of rows) r.extract ??= (await wikiPrimary(r.topic).catch(() => null))?.extract ?? '';
      writeFileSync(ITEMS, JSON.stringify(rows));
    }
    return rows;
  }
  const rows: Row[] = [];
  for (const topic of TOPICS) {
    const primary = await wikiPrimary(topic).catch(() => null);
    const batches = await Promise.allSettled(SOURCES.map((s) => searchSource(s, topic, { limit: 6 })));
    rows.push({ topic, primary: primary?.title, extract: primary?.extract ?? '', items: batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : [])) });
    console.log(`searched ${topic}: ${rows.at(-1)!.items.length} items`);
  }
  writeFileSync(ITEMS, JSON.stringify(rows));
  return rows;
}

/** Ground truth: an AI judge reads ten items at a time and says which are really about the topic. */
async function judge(rows: Row[]): Promise<Record<string, boolean>> {
  if (existsSync(JUDGED) && !process.argv.includes('--rejudge') && !process.argv.includes('--refresh')) return JSON.parse(readFileSync(JUDGED, 'utf8'));
  const out: Record<string, boolean> = {};
  for (const r of rows) {
    for (let i = 0; i < r.items.length; i += 10) {
      const chunk = r.items.slice(i, i + 10);
      const list = chunk.map((it, k) => `[${k + 1}] (${it.source}, ${it.kind}) ${it.title} — ${(it.snippet ?? '').slice(0, 220)}`).join('\n');
      const { value } = await completeWithFallback(
        resolveProviders(),
        {
          messages: [
            { role: 'system', content: 'You judge research search results. Output only JSON.' },
            {
              role: 'user',
              content: `TOPIC: ${r.topic}\nFor each item, would someone researching this topic want it pinned on their evidence board? YES if it is about this topic (articles, videos, books, papers, photos, discussions of it). NO if it only mentions the topic in passing, is a roundup where the topic is one entry among many, or is about a different thing that shares a word.\n\n${list}\n\nReturn {"yes": [item numbers]}`,
            },
          ],
          temperature: 0,
          maxTokens: 800,
        },
        (t) => (parseJsonLoose(t) as { yes: number[] }).yes.map(Number),
      );
      chunk.forEach((it, k) => (out[`${r.topic}|${it.id}`] = value.includes(k + 1)));
    }
    console.log(`judged ${r.topic}`);
  }
  writeFileSync(JUDGED, JSON.stringify(out));
  return out;
}

const rows = await collect();
const truth = await judge(rows);
let tp = 0;
let fp = 0;
let relevantTotal = 0;
let passed = 0;
const offTopic: string[] = [];
const filterDrops: string[] = [];
for (const r of rows) {
  const topic = { phrasings: [r.topic, r.primary], context: r.extract };
  const keep = relevanceFilter(topic);
  const bySource = new Map<string, SourceItem[]>();
  for (const it of r.items) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it]);
  const board = new Set([...bySource.values()].flatMap((list) => rankRelevant(list.filter(keep), topic).slice(0, PER)).map((i) => i.id));
  for (const it of r.items) {
    const yes = truth[`${r.topic}|${it.id}`];
    if (yes) {
      relevantTotal++;
      if (keep(it)) passed++;
      else filterDrops.push(`${r.topic} | ${it.source} | ${it.title.slice(0, 80)}`);
    }
    if (board.has(it.id)) {
      if (yes) tp++;
      else (fp++, offTopic.push(`${r.topic} | ${it.source} | ${it.title.slice(0, 80)}`));
    }
  }
}
const items = rows.reduce((s, r) => s + r.items.length, 0);
console.log(`\n${items} results, ${relevantTotal} judged on-topic, ${tp + fp} would be pinned (max ${PER} per source)`);
console.log(`board precision  ${((tp / (tp + fp)) * 100).toFixed(1)}%   of pinned clues are on-topic`);
console.log(`filter recall    ${((passed / relevantTotal) * 100).toFixed(1)}%   of on-topic results get past the filter`);
console.log(`\nPINNED BUT OFF-TOPIC (${offTopic.length}):\n  ${offTopic.join('\n  ')}`);
console.log(`\nWRONGLY FILTERED OUT (${filterDrops.length}):\n  ${filterDrops.join('\n  ')}`);
process.exit(0);
