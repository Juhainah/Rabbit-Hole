// How accurate is "dig deeper"? Digs into a card from inside a case, then an AI
// judge labels every result the board would get:
//   npx tsx scripts/eval-deeper.ts            (judgments are cached between runs)
// Two scores: "on the subject" (about the card at all) and "tied to the case"
// (about the card in the story of the case it came from).
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SOURCES } from '../shared/sources';
import type { DigEvent, SourceItem } from '../shared/types';
import { runDig } from '../server/dig';
import { parseJsonLoose } from '../server/json';
import { completeWithFallback, resolveProviders } from '../server/llm';

const CASES = [
  { topic: 'Jean Colombe', caseQuery: 'rotten.com' },
  { topic: 'Buenos Aires', caseQuery: 'Liam Payne death' },
  { topic: 'Leonid Kulik', caseQuery: 'Tunguska event' },
  { topic: 'Saturn V', caseQuery: 'Apollo 11' },
  { topic: 'Kholat Syakhl', caseQuery: 'Dyatlov Pass incident' },
  { topic: 'Voynich manuscript carbon dating', caseQuery: 'Voynich manuscript' },
];
const JUDGED = 'scripts/.eval-deeper-judged.json';
const judged: Record<string, { subject: boolean; linked: boolean }> = existsSync(JUDGED) ? JSON.parse(readFileSync(JUDGED, 'utf8')) : {};
const digSources = SOURCES.filter((s) => s.dig).map((s) => s.id);

/** Runs the evidence part of a dig (stops before the AI analysis) and returns what would be pinned. */
async function evidence(topic: string, caseQuery: string): Promise<SourceItem[]> {
  const items: SourceItem[] = [];
  const ctrl = new AbortController();
  const emit = (e: DigEvent) => {
    if (e.type === 'source' || e.type === 'photos' || e.type === 'media') items.push(...e.items);
    if (e.type === 'status' && /Connecting the dots/.test(e.message)) ctrl.abort();
  };
  await runDig({ topic, caseQuery, trail: [caseQuery], sources: digSources, perSource: 3 }, emit, ctrl.signal).catch(() => undefined);
  const seen = new Set<string>();
  return items.filter((it) => !seen.has(it.url ?? it.id) && seen.add(it.url ?? it.id));
}

async function judge(topic: string, caseQuery: string, items: SourceItem[]) {
  const todo = items.filter((it) => !judged[`${caseQuery}|${topic}|${it.id}`]);
  for (let i = 0; i < todo.length; i += 10) {
    const chunk = todo.slice(i, i + 10);
    const list = chunk.map((it, k) => `[${k + 1}] (${it.source}, ${it.kind}) ${it.title} — ${(it.snippet ?? '').slice(0, 200)}`).join('\n');
    const { value } = await completeWithFallback(
      resolveProviders(),
      {
        messages: [
          { role: 'system', content: 'You judge research results. Output only JSON.' },
          {
            role: 'user',
            content: `Someone is investigating "${caseQuery}". From that case they dug deeper into "${topic}".\nFor each item answer two questions:\nSUBJECT: is it really about "${topic}" (not a namesake, not a shopping/auction/market listing, not a roundup)?\nLINKED: does it connect "${topic}" to "${caseQuery}", or is it the core reference someone would need to understand "${topic}"'s role in that case?\n\n${list}\n\nReturn {"subject": [item numbers], "linked": [item numbers]}`,
          },
        ],
        temperature: 0,
        maxTokens: 600,
      },
      (t) => {
        const j = parseJsonLoose(t) as { subject: number[]; linked: number[] };
        return { subject: (j.subject ?? []).map(Number), linked: (j.linked ?? []).map(Number) };
      },
    );
    chunk.forEach((it, k) => (judged[`${caseQuery}|${topic}|${it.id}`] = { subject: value.subject.includes(k + 1), linked: value.linked.includes(k + 1) }));
    writeFileSync(JUDGED, JSON.stringify(judged));
  }
}

let total = 0;
let subject = 0;
let linked = 0;
const noise: string[] = [];
for (const c of CASES) {
  const items = await evidence(c.topic, c.caseQuery);
  await judge(c.topic, c.caseQuery, items);
  const marks = items.map((it) => judged[`${c.caseQuery}|${c.topic}|${it.id}`]);
  const s = marks.filter((m) => m?.subject).length;
  const l = marks.filter((m) => m?.linked).length;
  total += items.length;
  subject += s;
  linked += l;
  items.forEach((it, i) => !marks[i]?.subject && noise.push(`${c.topic} ← ${c.caseQuery} | ${it.source} | ${it.title.slice(0, 70)}`));
  console.log(`${`${c.topic}  (from ${c.caseQuery})`.padEnd(58)} ${String(items.length).padStart(3)} results · on the subject ${String(s).padStart(2)} · tied to the case ${String(l).padStart(2)}`);
}
console.log(`\nALL: ${total} results · on the subject ${((subject / total) * 100).toFixed(0)}% · tied to the case ${((linked / total) * 100).toFixed(0)}%`);
console.log(`\nOFF-SUBJECT (${noise.length}):\n  ${noise.slice(0, 30).join('\n  ')}`);
process.exit(0);
