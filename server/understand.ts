import type { SourceItem } from '../shared/types';
import { sleep } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';

// Before digging, read the search the way a librarian would: what is it really about, how is
// that spelled in the world, and where would a good researcher look? One spelling slip
// ("dedh ishqyiya") or a modifier in front of the name ("lgbtq dedh ishqiya") must not
// send the whole dig down the wrong hole.

export interface Understanding {
  /** The thing at the centre, spelled the way sources spell it ("Dedh Ishqiya", "Star Girl"). */
  subject: string;
  /** Other names sources use for it ("9/11" for "September 11 attacks"). */
  aliases: string[];
  /** What about it the user is after, in words sources would use ("LGBTQ", "queer", "Lihaaf"). */
  focus: string[];
  /** The search, spelled right and short: what every archive is asked. */
  query: string;
  /** The searches a great researcher would run, best first. */
  searches: string[];
  /** Where this kind of topic is documented or discussed (domains, r/subreddits). */
  sites: string[];
  /** Spelling fixes ("ishqyiya" → "Ishqiya"). */
  fixes: Record<string, string>;
  /** A link the search assumes that no result supports (a wrong company…). */
  doubt?: string;
}

const SYSTEM = `You plan research for a detective-board research app, like an expert librarian. The user typed a search (it may have typos, or put a word like "lgbtq" or "controversy" before the name). Use the FIRST RESULTS as evidence of what exists and how it is spelled. Output ONLY JSON:
{"subject": "the specific person, work, event, product, place or phenomenon at the centre, spelled exactly as the results spell it (e.g. \\"Dedh Ishqiya\\", \\"Star Girl\\", \\"September 11 attacks\\"); for a broad theme, its short core name",
 "aliases": ["up to 4 other names the results use for the same subject: short forms, other spellings"],
 "focus": ["up to 6 words or short phrases for WHAT ABOUT the subject the user wants, including the synonyms articles use (e.g. LGBTQ, queer, lesbian, same-sex); [] if they want the subject in general"],
 "query": "the search, spelling corrected, at most 6 words, subject first",
 "fixes": {"typed word": "corrected word"},
 "searches": ["6 web searches of 3-9 words, each containing the subject or an alias: the focus angle first; news coverage from when it happened (add a year only if the results show it; never guess one); who made, owns or runs it; first-hand accounts and discussions; the disputed or strange part; a later look-back or analysis. If the user names a related work, person or source (e.g. a story it was based on), one search for that link"],
 "sites": ["up to 4 domains or subreddits where THIS kind of topic is really documented or discussed (a film: imdb.com, its wiki, film critics; a game: its fandom wiki, r/<game>; a crime: court or local news; internet lore: knowyourmeme.com)"],
 "doubt": "one sentence if the typed search links things the results never connect (a wrong company, a connection no result shows), else empty"}
Use only names that appear in the typed search or the results. Never invent facts.`;

// Words that describe rather than name: "British singer" or "One Direction singer" would let in
// every article about any singer.
const DESCRIBING = /\b(singer|actor|actress|band|group|film|movie|game|app|company|brand|player|politician|writer|author|rapper|musician|celebrity|member|british|american|indian|english|french|german|former|famous)\b/i;

/** Another name for the subject, not a description of it: shares a word with it, or is a short proper name ("9/11", "1D"). */
function isName(alias: string, subject: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}/]+/u).filter((w) => w.length > 1);
  const own = new Set(words(subject));
  if (words(alias).some((w) => own.has(w)) && !DESCRIBING.test(alias.replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''))) return true;
  const parts = alias.trim().split(/\s+/);
  return parts.length <= 3 && !DESCRIBING.test(alias) && parts.every((p) => /^[\p{Lu}\d"“'(]/u.test(p));
}

/** Asks the AI to read the search against the first results. Null if no AI answers in time. */
export async function understand(asked: string, firstResults: SourceItem[], signal: AbortSignal, inCase?: string): Promise<Understanding | null> {
  const results = firstResults
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.title} — ${(r.snippet ?? '').slice(0, 220)}`)
    .join('\n');
  const user = [`TYPED: ${asked}`, inCase ? `INSIDE THE CASE: ${inCase} (they want this as it relates to that case)` : '', `FIRST RESULTS:\n${results || '(none)'}`].filter(Boolean).join('\n');
  const task = completeWithFallback(
    resolveProviders(),
    { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], temperature: 0.2, maxTokens: 700, signal, timeoutMs: 9000 },
    (t) => {
      const j = parseJsonLoose<Record<string, unknown>>(t);
      const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
      const list = (v: unknown, n: number, max = 120) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
      const subject = str(j.subject, 90);
      if (!subject) throw new Error('no subject');
      const fixes: Record<string, string> = {};
      if (j.fixes && typeof j.fixes === 'object') {
        for (const [k, v] of Object.entries(j.fixes as Record<string, unknown>)) {
          const to = str(v, 60);
          // A real fix changes a word the user actually typed.
          if (to && k.trim() && to.toLowerCase() !== k.trim().toLowerCase() && asked.toLowerCase().includes(k.trim().toLowerCase())) fixes[k.trim()] = to;
        }
      }
      return {
        subject,
        aliases: list(j.aliases, 4, 80).filter((a) => a.toLowerCase() !== subject.toLowerCase() && isName(a, subject)),
        focus: list(j.focus, 6, 40),
        query: str(j.query, 80) || subject,
        searches: list(j.searches, 6, 120),
        sites: list(j.sites, 4, 80)
          .map((x) => x.replace(/^https?:\/\//, '').replace(/\/$/, ''))
          .filter((x) => /^(r\/\w+|[\w.-]+\.[a-z]{2,})/i.test(x)),
        fixes,
        doubt: str(j.doubt, 300) || undefined,
      } satisfies Understanding;
    },
  ).then((r) => r.value);
  return Promise.race([task.catch(() => null), sleep(11000).then(() => null)]);
}
