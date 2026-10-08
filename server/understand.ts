import type { SourceItem } from '../shared/types';
import { sleep } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';

// Before digging, read the search the way a librarian would: what is it really about, how is
// that spelled in the world, and where would a good researcher look? One spelling slip
// in a name, or a word in front of it ("controversy …"), must not
// send the whole dig down the wrong hole.

const STOP_WORDS = new Set('the a an and or of in on at to for with by from about is was are game games mobile app movie film show series book controversy theory theories story history mystery'.split(' '));
const wordsOf = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
/** The words in a search that could be a name (not "game", "controversy", "the"). */
const typedWords = (t: string) => wordsOf(t).filter((w) => !STOP_WORDS.has(w));
/** A word the text has, allowing a slip of the keyboard in a long word ("theroies"). */
const near = (w: string, among: string[]) => among.some((x) => x === w || (w.length >= 5 && x.length >= 5 && levenshtein(w, x) <= (w.length >= 8 ? 2 : 1)));
/** Is this name in the text: run together ("stargirl"), or each of its words (allowing slips)? */
function typedName(name: string, text: string): boolean {
  const have = wordsOf(text);
  const whole = wordsOf(name).join('');
  // Run together, but only across whole words ("stargirl" = "star girl"; "stargirls" is not in "star girl star").
  for (let i = 0; i < have.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(have.length, i + 5); j++) {
      joined += have[j];
      if (joined === whole) return true;
      if (joined.length >= whole.length) break;
    }
  }
  const want = typedWords(name);
  return want.length > 0 && want.every((w) => near(w, have));
}
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export interface Understanding {
  /** The thing at the centre, spelled the way sources spell it. */
  subject: string;
  /** Other names sources use for it ("9/11" for "September 11 attacks"). */
  aliases: string[];
  /** What about it the user is after, in the words sources would use. */
  focus: string[];
  /** The search, spelled right and short: what every archive is asked. */
  query: string;
  /** The searches a great researcher would run, best first. */
  searches: string[];
  /** Where this kind of topic is documented or discussed (domains, r/subreddits). */
  sites: string[];
  /** Spelling fixes: the typed word and the one the sources use. */
  fixes: Record<string, string>;
  /** A link the search assumes that no result supports (a wrong company…). */
  doubt?: string;
}

const SYSTEM = `You plan research for a detective-board research app, like an expert librarian. The user typed a search (it may have typos, or put a word like "history" or "controversy" before the name). Use the FIRST RESULTS as evidence of what exists and how it is spelled. Output ONLY JSON:
{"subject": "the specific person, work, event, product, place or phenomenon at the centre, spelled exactly as the results spell it (the name as the results print it, not as typed); for a broad theme, its short core name",
 "aliases": ["up to 4 other names the results use for the same subject: short forms, other spellings"],
 "focus": ["up to 6 words or short phrases for WHAT ABOUT the subject the user wants, including the synonyms articles use (e.g. for a search about a band's break-up: break-up, split, left the band); [] if they want the subject in general"],
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
export function isName(alias: string, subject: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}/]+/u).filter((w) => w.length > 1);
  const own = new Set(words(subject));
  if (words(alias).some((w) => own.has(w)) && !DESCRIBING.test(alias.replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''))) return true;
  const parts = alias.trim().split(/\s+/);
  return parts.length <= 3 && !DESCRIBING.test(alias) && parts.every((p) => /^[\p{Lu}\d"“'(]/u.test(p));
}

/** Asks the AI to read the search against the first results. Null if no AI answers in time. */
/** `earlier`: the conversation so far, so "where is that article?" knows which article. */
export async function understand(asked: string, firstResults: SourceItem[], signal: AbortSignal, inCase?: string, earlier?: string): Promise<Understanding | null> {
  const results = firstResults
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.title} — ${(r.snippet ?? '').slice(0, 220)}`)
    .join('\n');
  const user = [
    earlier ? `EARLIER IN THE CONVERSATION (the typed message may refer back to it: "that article", "it", "them"; resolve those words from here):\n${earlier.slice(0, 1500)}` : '',
    `TYPED: ${asked}`, inCase ? `INSIDE THE CASE: ${inCase}. The subject is what they TYPED (a person, place or thing within that case), never the case itself; the searches look for the typed subject's part in the case.` : '', `FIRST RESULTS:\n${results || '(none)'}`].filter(Boolean).join('\n');
  const task = completeWithFallback(
    resolveProviders(),
    { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], temperature: 0.2, maxTokens: 700, signal, timeoutMs: 9000 },
    (t) => {
      const j = parseJsonLoose<Record<string, unknown>>(t);
      const str = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
      const list = (v: unknown, n: number, max = 120) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
      const subject = str(j.subject, 90);
      if (!subject) throw new Error('no subject');
      // The subject is what the user typed (respelled at most). A different name is allowed only when the
      // first results show the two together ("9 11" → "September 11 attacks"); junk results about something
      // else ("Stellar Blade" for "star girl") must never turn the dig into a dig about that.
      if (!typedName(subject, [asked, inCase ?? '', earlier ?? ''].join(' '))) {
        const typed = [...new Set(typedWords(asked))];
        const bridged = firstResults.some((r) => {
          const text = `${r.title} ${r.snippet ?? ''}`;
          return typedName(subject, text) && typed.filter((w) => near(w, wordsOf(text))).length >= Math.min(2, typed.length);
        });
        if (!bridged) throw new Error(`subject "${subject}" is not what was typed`);
      }
      const fixes: Record<string, string> = {};
      if (j.fixes && typeof j.fixes === 'object') {
        for (const [k, v] of Object.entries(j.fixes as Record<string, unknown>)) {
          const to = str(v, 60);
          // A real fix changes a word the user actually typed.
          // …and is a real correction: "girl" → "Girls" (a plural, a capital letter) is not.
          const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/(es|s)$/, '');
          if (to && k.trim() && bare(to) !== bare(k) && asked.toLowerCase().includes(k.trim().toLowerCase())) fixes[k.trim()] = to;
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
