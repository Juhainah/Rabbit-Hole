import type { Analysis, ChatMessage, Entity, EntityType, Primary, SourceItem } from '../shared/types';
import { sourceMeta } from '../shared/sources';

const DIG_SYSTEM = `You are the research engine inside "Rabbit Hole", an app where curious people fall down rabbit holes on a detective-style evidence board. You receive a topic plus raw evidence from many sources, and you turn it into a web of clues.

Rules:
- Use only facts that appear in the MAIN ARTICLE or the EVIDENCE. Never fill gaps from memory: no names, companies, dates, places or claims the sources don't contain. If the evidence is thin, make a small case and say so. Flag speculation as speculation.
- Prefer the surprising, strange and specific: names, dates, places, numbers, documents.
- Entities are concrete things (a real person, place, organisation, event, object, work, or a named concept), never vague themes.
- Relations should form a WEB: connect entities to each other, not only to the topic.
- Tangents are the rabbit holes: adjacent, genuinely intriguing topics a curious person would click next. Each hook must create an itch to know more. Never just rephrase the topic.
- Questions are open mysteries, contradictions, or live debates.
- The timeline is what happened in the story (releases, removals, incidents, rulings, when a rumour began), never when an article or video about it was published.
- Output ONLY a JSON object. No markdown, no commentary.`;

const SCHEMA = `{
  "title": "evocative case title, max 6 words, about this topic only",
  "summary": "4-6 sentences: what it is, why it matters, what is strange about it",
  "hook": "one gripping sentence",
  "entities": [{"name": "", "type": "person|place|org|event|concept|object|work", "description": "1-2 specific sentences", "date": "YYYY or YYYY-MM-DD (omit if none)", "place": "for places/events: geocodable location, e.g. 'Kholat Syakhl, Russia' (omit otherwise)"}],
  "relations": [{"from": "entity name or TOPIC", "to": "entity name", "label": "2-4 word verb phrase"}],
  "timeline": [{"date": "YYYY[-MM[-DD]] (negative year for BC)", "event": "short line"}],
  "tangents": [{"title": "", "hook": "one sentence on why it's a rabbit hole", "query": "best search query for it"}],
  (tangents must connect through substance: the same people, events, places, phenomena or mechanisms; never through a shared word or name, like another person who happens to be called the same)
  "questions": ["open question"],
  "cites": [{"evidence": 3, "entity": "exact entity name from entities", "label": "2-5 words: what this source shows about it"}],
  "offtopic": [evidence numbers that are NOT really about this topic, e.g. lists or posts that only mention it in passing],
  "premise": "one sentence if the topic as typed contains a name, link or claim the evidence does not support (a wrong company, a connection no source documents), saying what the sources do show; otherwise an empty string"
}
Counts: 7-10 entities, 8-14 relations, 4-8 timeline items, 5-7 tangents, 2-4 questions, 4-12 cites (every important piece of evidence, especially first-hand accounts, threads and documents, tied to the entity it is evidence about). offtopic may be empty.`;

/** `compact` trims the case file for small/anonymous models that choke on long prompts. */
export function digMessages(
  topic: string,
  trail: string[],
  primary: Primary | null,
  evidence: SourceItem[],
  compact = false,
  fromCase?: string,
  premiseNote?: string,
  venue?: string,
): ChatMessage[] {
  const lines: string[] = [`TOPIC: ${topic}`];
  if (premiseNote) lines.push(`PREMISE CHECK: ${premiseNote} Build the case only from what the evidence shows, and say this plainly in "premise".`);
  if (venue && fromCase) {
    lines.push(`THIS DIG COLLECTS WHAT PEOPLE ON ${venue.toUpperCase()} SAY ABOUT "${fromCase}". Summarise those discussions: the claims, who made them, what was debunked. Do not describe ${venue} itself.`);
  }
  if (fromCase && !venue) {
    lines.push(
      `THIS IS A DEEPER DIG INSIDE THE CASE "${fromCase}". The user wants ${topic}'s part in that story: make the summary, hook, entities and relations about how ${topic} connects to ${fromCase}, as far as the evidence shows. If the sources show no real link, say so plainly instead of inventing one. Background that has nothing to do with ${fromCase} goes in "offtopic".`,
    );
  }
  if (trail.length) {
    lines.push(`HOW THEY GOT HERE (rabbit-hole trail): ${trail.join(' → ')} → ${topic}`);
    if (!fromCase) lines.push(`This is a NEW rabbit hole. Make the case file about ${topic} itself. Mention an earlier step only where the sources show a real link; never invent one.`);
  }
  if (primary) {
    lines.push(`\nMAIN ARTICLE: ${primary.title} (${sourceMeta(primary.source).name})\n${primary.extract.slice(0, compact ? 1800 : 5500)}`);
    if (primary.related?.length) lines.push(`\nRELATED ARTICLES (tangent seeds): ${primary.related.slice(0, compact ? 8 : 12).join('; ')}`);
  }
  const ev = evidence.map((it, i) => {
    const bits = [`[${i + 1}] (${sourceMeta(it.source).name}) ${it.title}`];
    if (it.date) bits.push(`{${it.date}}`);
    if (it.snippet) bits.push(`— ${it.snippet.slice(0, compact ? 110 : 220)}`);
    return bits.join(' ');
  });
  if (ev.length) lines.push(`\nEVIDENCE FROM THE ARCHIVES:\n${ev.join('\n')}`);
  lines.push(`\nReturn JSON in exactly this shape:\n${SCHEMA}`);
  return [
    { role: 'system', content: DIG_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

/** Small follow-up call when a model forgot the rabbit holes, which are the whole point. */
export function tangentMessages(topic: string, summary: string, related: string[]): ChatMessage[] {
  return [
    { role: 'system', content: 'You suggest fascinating rabbit holes. Output ONLY JSON.' },
    {
      role: 'user',
      content: `TOPIC: ${topic}\n${summary.slice(0, 600)}\n${related.length ? `Related articles: ${related.slice(0, 12).join('; ')}\n` : ''}
Suggest 6 adjacent rabbit holes a curious person would click next. Specific, strange, irresistible. Not the topic itself.
Return: {"tangents":[{"title":"","hook":"one sentence on why it's a rabbit hole","query":"search query"}]}`,
    },
  ];
}

export function normalizeTangents(raw: any): Analysis['tangents'] {
  return list(raw?.tangents)
    .map((t) => ({ title: str(t?.title, 90), hook: str(t?.hook, 240), query: str(t?.query, 120) || str(t?.title, 90) }))
    .filter((t) => t.title)
    .slice(0, 8);
}

const TYPES: EntityType[] = ['person', 'place', 'org', 'event', 'concept', 'object', 'work', 'date'];
const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function normalizeAnalysis(raw: any, topic: string): Analysis {
  if (!raw || typeof raw !== 'object') throw new Error('analysis was not an object');
  const seen = new Set<string>();
  const entities: Entity[] = list(raw.entities)
    .map((e) => {
      const type = str(e?.type).toLowerCase() as EntityType;
      return {
        name: str(e?.name, 80),
        type: TYPES.includes(type) ? type : 'concept',
        description: str(e?.description, 400),
        date: str(e?.date, 20) || undefined,
        place: str(e?.place, 120) || undefined,
      };
    })
    .filter((e) => {
      const k = e.name.toLowerCase();
      if (!e.name || seen.has(k) || k === topic.toLowerCase()) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 12);
  if (!entities.length) throw new Error('analysis had no entities');

  const known = new Map(entities.map((e) => [e.name.toLowerCase(), e.name]));
  const resolve = (n: string) => {
    const k = n.trim().toLowerCase();
    if (k === 'topic' || k === topic.toLowerCase()) return 'TOPIC';
    return known.get(k) ?? [...known.entries()].find(([key]) => key.includes(k) || k.includes(key))?.[1];
  };
  const relations = list(raw.relations)
    .map((r) => ({ from: resolve(str(r?.from, 80)), to: resolve(str(r?.to, 80)), label: str(r?.label, 40) || 'linked to' }))
    .filter((r): r is { from: string; to: string; label: string } => !!r.from && !!r.to && r.from !== r.to)
    .slice(0, 20);

  return {
    title: str(raw.title, 80) || topic,
    summary: str(raw.summary, 1400),
    premise: str(raw.premise, 320) || undefined,
    hook: str(raw.hook, 240),
    entities,
    relations,
    timeline: list(raw.timeline)
      .map((t) => ({ date: str(String(t?.date ?? ''), 24), event: str(t?.event, 200) }))
      .filter((t) => t.date && t.event)
      .slice(0, 10),
    tangents: list(raw.tangents)
      .map((t) => ({ title: str(t?.title, 90), hook: str(t?.hook, 240), query: str(t?.query, 120) || str(t?.title, 90) }))
      .filter((t) => t.title)
      .slice(0, 8),
    questions: list(raw.questions)
      .map((q) => str(typeof q === 'string' ? q : q?.question, 240))
      .filter(Boolean)
      .slice(0, 5),
    citations: list(raw.cites)
      .map((c) => ({ evidence: Number(c?.evidence), entity: str(c?.entity, 80), label: str(c?.label, 40) || undefined }))
      .filter((c) => Number.isInteger(c.evidence) && c.evidence > 0 && c.entity)
      .slice(0, 16),
    offtopic: list(raw.offtopic)
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

export const CHAT_SYSTEM = `You are the user's research partner inside "Rabbit Hole", a visual evidence board for falling down rabbit holes. You are curious, precise and a little bit obsessive, with the tone of a great documentary narrator, but rigorous about evidence.

- Everything is about the user's investigation. When they ask about a card (a city, a person, an object), answer about its role in THEIR case, never a generic encyclopedia entry.
- Answer directly first, then add the fascinating details.
- Only state facts found in the SOURCES or the BOARD CONTEXT. If neither covers something, say you don't know rather than guessing; never invent companies, dates, places, quotes or links.
- If the user says they made a mistake (a wrong name, a typo), agree plainly, say what the sources actually show, and offer to tidy up with the remove or rename actions below.
- Use short paragraphs and tight bullet lists. Bold the key names.
- When SOURCES are provided, cite them inline as [1], [2]. Never invent citations.
- Separate established fact from theory and speculation.
- If some SOURCES have nothing to do with the question, ignore them silently. Never comment on the search, on source quality, or on how the app works; just answer from what is relevant (the board counts).
- If the board context is relevant, connect your answer to clues already on the board.
- Whenever you mention a card that is on the board, write its EXACT title in double square brackets, like [[Leonid Kulik]]. The user can click it to fly to that card. Only link titles that appear in the CARDS list.
- Asked where cards came from ("anything from the Smithsonian?", "is there data.gov stuff?"), answer from WHERE THE CARDS CAME FROM: name the archive (and the other name it goes by) and link EVERY one of its cards as [[exact title]], copying the title exactly as listed. Never say a source is missing without checking that list.
- You can act on the board. When the user asks you to add, pin, bring, show, connect, note, remove or rename something, put one line per action right before the TANGENTS line:
  ACTION: pin 3            (pins source [3]; use for photos, documents, videos. Several: ACTION: pin 2, 5)
  ACTION: connect [[Card A]] -> [[Card B]] : short label
  ACTION: note Chat feature removed in 2014; no abuse was ever proven [3]
  ACTION: remove [[Card]]          (only when the user asks to remove or clean up)
  ACTION: rename [[Card]] : New title
  ACTION: add to [[Card]] : a fact to write on that card, ending with its source like [2]
  ACTION: card person Jeffrey Epstein : one line on who this is in the case
    (card kinds: person, place, event, org, object, concept; then connect it in the same reply)
  Only pin numbers from the SOURCES list; connect and add to titles from the CARDS list or cards you create in the same reply. Say in your answer what you did.
  Only write facts on cards that a SOURCE or the board supports. If the sources do not support a link the user asks for, say so plainly and suggest what to search; never invent one.
  When the user wants a picture, pin sources marked (has a photo): those become real photos on the board. A web page about photos is not a photo.
- End EVERY reply with one final line exactly like:
TANGENTS: first rabbit hole | second rabbit hole | third rabbit hole
(three short, specific, irresistible topics to explore next)`;

export function chatMessages(history: ChatMessage[], context: string | undefined, sources: SourceItem[]): ChatMessage[] {
  const sys: string[] = [CHAT_SYSTEM];
  if (context?.trim()) sys.push(`\nBOARD CONTEXT (what the user is looking at):\n${context.slice(0, 12000)}`);
  if (sources.length) {
    sys.push(
      `\nSOURCES (fresh research for this question):\n${sources
        .map((s, i) => `[${i + 1}] ${sourceMeta(s.source).name}${s.image ? ' (has a photo)' : ''}${s.media ? ' (playable)' : ''}: ${s.title}${s.date ? ` (${s.date})` : ''} — ${(s.snippet ?? '').slice(0, 400)}`)
        .join('\n')}`,
    );
  }
  return [{ role: 'system', content: sys.join('\n') }, ...history.filter((m) => m.role !== 'system').slice(-16)];
}
