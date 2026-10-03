import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';

// "Weave this": the AI reads the cards on a board and suggests strings between the ones the
// cards themselves show are connected. Suggestions only; the user accepts or dismisses each.

export interface WeaveCard {
  id: string;
  title: string;
  text?: string;
  kind?: string;
}

export interface WeaveLink {
  a: string;
  b: string;
  label: string;
  why: string;
}

const SYSTEM = `You help someone connect the cards on their investigation board. Each card has a number, a kind, a title and its text.
Suggest strings between cards that ARE connected according to what the cards say: the same person, place, event, date, object or claim; one card is evidence for another; one explains, contradicts or caused another.
Rules:
- Use only what is written on the cards. Never connect cards just because they share a common word, and never invent a link.
- The label must say exactly what the cards say (if a card says something was taken, the label says taken). Never claim one thing happened before another unless both cards give dates.
- Skip pairs listed as ALREADY TIED.
- At most 10 suggestions, strongest first. Fewer is fine; none is fine.
Output ONLY JSON: {"links": [{"a": card number, "b": card number, "label": "2-4 word label for the string", "why": "one short sentence quoting what on the cards connects them"}]}`;

export async function suggestLinks(cards: WeaveCard[], tied: [string, string][], signal: AbortSignal): Promise<WeaveLink[]> {
  const list = cards.slice(0, 80);
  const num = new Map(list.map((c, i) => [c.id, i + 1]));
  const lines = list.map((c, i) => `[${i + 1}] (${c.kind ?? 'card'}) ${c.title.slice(0, 90)}${c.text ? ` — ${c.text.replace(/\s+/g, ' ').slice(0, 240)}` : ''}`);
  const already = tied
    .map(([a, b]) => (num.has(a) && num.has(b) ? `${num.get(a)}-${num.get(b)}` : null))
    .filter(Boolean)
    .slice(0, 200);
  const { value } = await completeWithFallback(
    resolveProviders(),
    {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `CARDS:\n${lines.join('\n')}\n\nALREADY TIED: ${already.join(', ') || 'none'}` },
      ],
      temperature: 0.2,
      maxTokens: 1400,
      signal,
      timeoutMs: 45000,
    },
    (text) => {
      const j = parseJsonLoose<{ links?: { a?: unknown; b?: unknown; label?: unknown; why?: unknown }[] }>(text);
      if (!Array.isArray(j.links)) throw new Error('no links list');
      return j.links;
    },
  );
  const seen = new Set(tied.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const out: WeaveLink[] = [];
  for (const l of value) {
    const a = list[Number(l.a) - 1];
    const b = list[Number(l.b) - 1];
    if (!a || !b || a.id === b.id || seen.has(`${a.id}|${b.id}`)) continue;
    seen.add(`${a.id}|${b.id}`).add(`${b.id}|${a.id}`);
    out.push({ a: a.id, b: b.id, label: String(l.label ?? '').trim().slice(0, 40) || 'connected', why: String(l.why ?? '').trim().slice(0, 240) });
    if (out.length >= 10) break;
  }
  return out;
}
