import type { SourceItem } from '../shared/types';

// Search APIs happily return things that merely share a word with the query.
// A clue only makes the board if it genuinely mentions the topic, and the best
// matches get the limited slots. Measured with scripts/eval-relevance.ts.

const STOP = new Set(
  'the and for with from into over after before under between through during without within upon are was were been being its this that these those what which who whom whose why how when where there here than then such not nor only own same too very can will just should now also any each few more most other some both all their them they his her him she you your our out off once again did does doing have has had having would could about'.split(
    ' ',
  ),
);

// Words too generic to identify a topic on their own ("incident", "mystery"…).
const GENERIC = new Set(
  'people thing things world life part case cases story stories history historical theory theories mystery mysteries mysterious secret secrets strange weird unknown unexplained famous real truth true fact facts event events incident incidents death deaths dead die died killed murder war wars battle city town place places country countries state states government group family name names book books film films movie movies video videos article articles news report reports list top best worst one two three four five six seven eight nine ten hundred thousand million century centuries modern ancient early late known found discovered use used using make made based man men woman women day days year years time times old new first last long great little many much good way even back really explained explain why what conspiracy conspiracies hoax hoaxes legend legends myth myths rumor rumors rumour rumours controversy scandal'.split(
    ' ',
  ),
);

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

const stem = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The words that name the subject ("talking", "angela" in "Talking Angela conspiracy theories"), as typed. */
export function subjectWords(q: string): string[] {
  const anchors = new Set(phrasing(q).anchors);
  return tokens(q).filter((w) => anchors.has(stem(w)) || anchors.has(w));
}

/** Does this text name the subject? All its distinctive words for short names, most of them for long ones. */
export function namesSubject(q: string, text: string): boolean {
  const p = phrasing(q);
  if (!p.anchors.length) return true;
  const hit = hitsIn(tokens(text), p);
  if (p.anchors.length > 2 && !subjectHead(p).every((w) => hit.has(w))) return false;
  return p.anchors.length <= 2 ? hit.size === p.anchors.length : hit.size >= p.anchors.length - 1;
}

/** Does the text say the name itself, its words side by side ("Bakery Story"), not just each word somewhere? */
export function saysName(name: string, text: string): boolean {
  const want = tokens(name).map(stem);
  if (!want.length) return true;
  const got = tokens(text).map(stem);
  for (let i = 0; i + want.length <= got.length; i++) {
    if (want.every((w, j) => got[i + j] === w)) return true;
  }
  return false;
}

const ASKING = new Set('what which who whom whose why how when where whats is are was were did do does can could would should will please tell show find bring add pin give list explain any some about there here specific specifically being been'.split(' '));

/**
 * A long topic or a question as a short search: "Star girl game controversy star chat" → "Star girl
 * game chat"; "What long-term health consequences … World Trade Center collapse?" with lead "9/11" →
 * "9/11 World Trade Center health consequences". Names first, then the telling words; never filler.
 */
export function compactQuery(q: string, max = 5, lead = ''): string {
  const words = q.replace(/[?!.,;:()"“”]+/g, ' ').split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (w: string) => { const k = norm(w); if (!seen.has(k)) { seen.add(k); out.push(w); } };
  for (const w of lead.split(/\s+/).filter(Boolean)) add(w);
  const keep = (w: string) => {
    const t = tokens(w);
    return t.some((x) => /\d/.test(x) || (x.length >= 3 && !STOP.has(x) && !GENERIC.has(stem(x)) && !ASKING.has(x)));
  };
  const named = words.filter((w, i) => i > 0 && /^[A-Z0-9]/.test(w) && keep(w));
  for (const w of named) add(w);
  for (const w of words) if (keep(w)) add(w);
  return out.slice(0, max).join(' ') || q;
}

/** The subject's name as typed ("star girl" in "star girl mobile game controversy"). */
export function subjectName(q: string): string {
  const p = phrasing(q);
  if (!p.anchors.length) return q;
  const head = new Set(subjectHead(p));
  const toks = tokens(q);
  const first = toks.findIndex((w) => head.has(stem(w)) || head.has(w));
  return toks.slice(first, first + head.size).join(' ') || q;
}

/** Topic words (stemmed, de-duplicated), in the order they appear. */
export function terms(q: string): string[] {
  return [...new Set(tokens(q).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))];
}

interface Phrasing {
  all: string[];
  anchors: string[];
  /** Anchor pairs that sit side by side in the query ("numbers station"): they must stay close in the text. */
  pairs: [string, string][];
  whole: string;
}

function phrasing(q: string): Phrasing {
  const toks = tokens(q);
  const kept = toks.map((w, i) => ({ w: stem(w), i })).filter(({ w }) => w.length >= 3 && !STOP.has(w));
  let anchors = kept.filter(({ w }) => !GENERIC.has(w));
  if (!anchors.length) {
    const numbers = toks.map((w, i) => ({ w, i })).filter(({ w }) => /^\d+$/.test(w));
    if (numbers.length) {
      anchors = numbers;
      kept.push(...numbers);
    }
  }
  const pairs: [string, string][] = [];
  for (let k = 1; k < anchors.length; k++) if (anchors[k].i - anchors[k - 1].i === 1) pairs.push([anchors[k - 1].w, anchors[k].w]);
  return { all: [...new Set(kept.map((x) => x.w))], anchors: [...new Set(anchors.map((x) => x.w))], pairs, whole: toks.join(' ') };
}

// "station" matches station, stations, station's; never compass, moonlight, station19.
const SUFFIX = /^(s|es|ed|ing|n|ns|ian|ians)?$/;
function positions(toks: string[], term: string): number[] {
  const out: number[] = [];
  toks.forEach((t, i) => {
    if (t === term || (t.startsWith(term) && SUFFIX.test(t.slice(term.length)))) out.push(i);
  });
  return out;
}

/** Which anchors truly hit: present, and paired names found near each other. */
function hitsIn(toks: string[], p: Phrasing): Set<string> {
  const pos = new Map(p.anchors.map((a) => [a, positions(toks, a)]));
  const hit = new Set(p.anchors.filter((a) => pos.get(a)!.length));
  for (const [a, b] of p.pairs) {
    if (!hit.has(a) || !hit.has(b)) continue;
    // In order and close: "numbers station", not "Station platform numbers".
    const close = pos.get(a)!.some((x) => pos.get(b)!.some((y) => y - x === 1 || (y - x === 2 && toks[x + 1].length <= 2)));
    if (!close) hit.delete(b);
  }
  return hit;
}

export interface PremiseCheck {
  /** The search with typos and unconnected names taken out ("talking angela theories"). */
  focus: string;
  /** Names no result contains at all ("storm8" next to Talking Angela). */
  unknown: string[];
  /** Names the results mention, but never together with the rest of the search. */
  unlinked: string[];
  /** Misspellings and the word the results use instead ({ theroies: "theories" }). */
  typos: Record<string, string>;
}

/**
 * Checks a search against what the web actually says before digging. Words that
 * appear in no result are dropped (typos), and a name that only ever appears
 * apart from the rest of the search is flagged rather than built into the case.
 */
export function checkPremise(q: string, docs: { title: string; snippet?: string }[]): PremiseCheck {
  const none: PremiseCheck = { focus: q, unknown: [], unlinked: [], typos: {} };
  const p = phrasing(q);
  if (p.anchors.length < 2 || docs.length < 3) return none;
  const docToks = docs.map((d) => tokens(`${d.title} ${d.snippet ?? ''}`));
  const mentions = (a: string) => docToks.filter((dt) => positions(dt, a).length).length;
  const present = p.anchors.filter((a) => mentions(a) > 0);
  if (!present.length) return none; // nothing matched at all: leave it to the dig to say so
  // Results that mostly miss the subject's own name ("star girl") say nothing about the rest of the search.
  const head = subjectHead(p);
  const aboutIt = docToks.filter((dt) => { const hit = hitsIn(dt, p); return head.every((w) => hit.has(w)); }).length;
  if (aboutIt < Math.min(2, docs.length)) return none;
  // Group the words that appear together in results; the biggest group is the real subject.
  const root = new Map(present.map((a) => [a, a]));
  const find = (a: string): string => (root.get(a) === a ? a : find(root.get(a)!));
  for (const dt of docToks) {
    const here = present.filter((a) => positions(dt, a).length);
    for (const a of here.slice(1)) root.set(find(a), find(here[0]));
  }
  const weight = new Map<string, number>();
  for (const a of present) weight.set(find(a), (weight.get(find(a)) ?? 0) + mentions(a));
  const main = [...weight].sort((a, b) => b[1] - a[1])[0][0];
  const unlinkedStems = present.filter((a) => find(a) !== main);
  const unknownStems = p.anchors.filter((a) => !present.includes(a));
  // Keep the words as typed, minus the dropped ones.
  const typed = tokens(q);
  const original = (stems: string[]) => stems.map((s) => typed.find((w) => stem(w) === s) ?? s);
  // A word missing from every result is either a typo of one that's there, or a name nobody connects.
  const seenWords = new Set(docToks.flat().filter((w) => w.length >= 4));
  const typos: Record<string, string> = {};
  for (const w of original(unknownStems)) {
    if (w.length < 5 || head.includes(stem(w))) continue;
    const near = [...seenWords].find((s) => Math.abs(s.length - w.length) <= 2 && editDistance(w, s) <= (w.length >= 7 ? 2 : 1));
    if (near) typos[w] = near;
  }
  // Only something name-like is set aside: "storm8", or a word typed with a capital. An ordinary
  // word the first results happen to miss ("children") stays in the search.
  const nameLike = (w: string) => /\d/.test(w) || new RegExp(`(^|[^\\p{L}])${w[0].toUpperCase()}${w.slice(1)}`, 'u').test(q);
  const unknown = original(unknownStems).filter((w) => !typos[w] && nameLike(w));
  const unlinked = original(unlinkedStems).filter((w) => nameLike(w) && !head.includes(stem(w)));
  const drop = new Set([...unknown, ...unlinked]);
  const focus = typed.filter((w) => !drop.has(w) && (w.length > 1 || /\d/.test(w))).map((w) => typos[w] ?? w).join(' ');
  return { focus: focus || q, unknown, unlinked, typos };
}

/** Optimal string alignment distance: "theroies" → "theories" is 1 (a swap). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * A thread title names its subject and little else ("My Dark History With Star Girl"), so a post
 * passes when it names the subject, the first name in the search, even without the descriptive words.
 */
function namesFirstSubject(toks: string[], p: Phrasing): boolean {
  const pair = p.pairs[0];
  if (!pair || p.anchors.indexOf(pair[0]) !== 0) return false;
  const hit = hitsIn(toks, p);
  return hit.has(pair[0]) && hit.has(pair[1]);
}

/** The subject's own name: the leading pair of words that sit together ("star girl"), or the first word. */
function subjectHead(p: Phrasing): string[] {
  const pair = p.pairs[0];
  return pair && p.anchors.indexOf(pair[0]) === 0 ? pair : [p.anchors[0]];
}

function passes(toks: string[], p: Phrasing, lenient: boolean, post = false, strict = false): boolean {
  if (!p.all.length) return true;
  if (post && p.anchors.length > 2 && namesFirstSubject(toks, p)) return true;
  if (!p.anchors.length) return p.all.filter((w) => positions(toks, w).length).length >= Math.ceil(p.all.length / 2);
  const hit = hitsIn(toks, p);
  const hits = hit.size;
  const n = p.anchors.length;
  // Every result must name the subject, the name the search starts with: "Star Girl" needs both
  // words together (not Honkai Star Rail, not a T-shirt with "stars"); "Apollo 11" needs "Apollo".
  if (n > 2 && !subjectHead(p).every((w) => hit.has(w))) return false;
  // A two-word name said together ("Star Girl") is the subject, however much else the search says
  // ("star girl game controversy star chat"): "Outblaze sells Star Girl to Crosby Capital" is the case.
  // Namesakes that share it are left to the AI, which reads every result before the board is final.
  if (n > 3 && subjectHead(p).length === 2 && !strict) return true;
  if (lenient) return hits >= Math.min(n, n <= 2 ? n : n - 1) || (n > 2 && hits >= 2);
  if (n <= 2) return hits === n;
  if (n <= 4) return hits >= n - 1;
  return hits >= Math.ceil(n * 0.6);
}

// Sources whose own search engines are good, or whose items rarely repeat the query words.
const LENIENT = new Set(['wikipedia', 'nasa', 'met', 'artic', 'cleveland', 'vam', 'wellcome', 'smithsonian', 'europeana', 'wikidata', 'wikiquote', 'wikisource']);
// Sources where the query isn't a topic, so there's nothing to check.
const EXEMPT = new Set(['wayback', 'places', 'nearby', 'oeis', 'wiktionary', 'urbandictionary', 'musicbrainz', 'inaturalist']);

// Everyday words that say nothing about what an article is about.
const PLAIN = new Set(
  'became become becoming including later born since while called named often several well among although because however according january february march april june july august september october november december'.split(' '),
);

/** What the case is about beyond its name: the distinctive words of its main article. */
function contextOf(extract: string | undefined, ps: Phrasing[]): Set<string> {
  if (!extract) return new Set();
  const own = new Set(ps.flatMap((p) => p.all));
  return new Set(tokens(extract.slice(0, 900)).map(stem).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w) && !PLAIN.has(w) && !own.has(w)));
}

/** The case a result is judged against: ways of naming it, plus its main article's text. */
export interface Topic {
  phrasings: (string | undefined)[];
  context?: string;
  /** No name-alone pass: the result must also say what the search is about. */
  strict?: boolean;
  /** The angle wanted ("LGBTQ", "queer"): results that speak to it rank first. */
  focus?: string[];
}

const textOf = (item: SourceItem) => (item.kind === 'post' ? item.title : [item.title, item.snippet, item.author].filter(Boolean).join(' '));

/**
 * Builds a filter from one or more phrasings of the topic (the query, the main
 * article's title…). An item survives if it matches any phrasing.
 */
export function relevanceFilter(topic: Topic) {
  const ps = topic.phrasings.filter((p): p is string => !!p?.trim()).map(phrasing);
  const ctx = contextOf(topic.context, ps);
  const askedFor = (re: RegExp) => ps.some((p) => re.test(p.whole));
  return (item: SourceItem): boolean => {
    if (EXEMPT.has(item.source) || !ps.length) return true;
    // Topic, tag and search-result pages list everything and are about nothing.
    if (item.url && /^https?:\/\/[^/]+\/(.*\/)?(topics?|tags?|categor(y|ies)|search|explore|hashtag)(\/|$)/i.test(item.url)) return false;
    // Roundups and side-pages (albums, "… in fiction") share the name, not the subject.
    if (ROUNDUP.test(item.title) && !askedFor(ROUNDUP)) return false;
    if (SIDE_PAGE.test(item.title) && !askedFor(SIDE_PAGE)) return false;
    // Forum posts often mention a topic in passing ("my top 20 films"); require it in the title.
    const toks = tokens(textOf(item));
    // Wikipedia's other hits are neighbouring articles (tangents, not evidence) unless the title names the topic.
    if (item.source === 'wikipedia') {
      const title = tokens(item.title);
      if (!ps.some((p) => hitsIn(title, p).size > 0)) return false;
    }
    if (!ps.some((p) => passes(toks, p, LENIENT.has(item.source), item.kind === 'post', topic.strict))) return false;
    // Named only in passing (a line-up, an author list)? Then it must also touch the case's
    // subject, or it's likely a namesake: Leonid Kulik the noise band, not the meteorite hunter.
    if (ctx.size && !LENIENT.has(item.source) && !ps.some((p) => hitsIn(tokens(item.title), p).size)) return toks.some((t) => ctx.has(stem(t)));
    return true;
  };
}

// Roundups mention everything and are about nothing in particular.
const ROUNDUP = /\b(top \d+|\d+ (most|best|weirdest|creepiest|scariest|strangest|biggest|greatest)|most (disturbing|terrifying|mysterious)|list of|roundup|daily .*news|this week in|color by number)\b/i;
// Side-pages that share the name but not the subject.
const SIDE_PAGE =
  /\b(discography|album|song|single|in popular culture|in fiction|soundtrack|video game|board game|longplay|walkthrough|let'?s play|playthrough|gameplay|speedrun)\b|\((tv|television|web) series\)|\((film|novel|book|band|musical|play|opera|comics?|manga|video game|game|tv series|disambiguation)\)/i;

/** Does this result use any of the case's own words ("animoca", "boyfriends", "simsimi")? */
export function touches(item: SourceItem, vocabulary: Set<string>): boolean {
  return tokens(`${item.title} ${item.snippet ?? ''}`).some((t) => vocabulary.has(stem(t)) || vocabulary.has(t));
}

/** Best matches first, so the few board slots per source go to the strongest evidence. */
export function rankRelevant(items: SourceItem[], topic: Topic): SourceItem[] {
  const ps = topic.phrasings.filter((p): p is string => !!p?.trim()).map(phrasing);
  if (!ps.length) return items;
  const ctx = contextOf(topic.context, ps);
  const wanted = new Set(ps.flatMap((p) => p.all));
  const focus = (topic.focus ?? []).map((f) => tokens(f).join(' ')).filter(Boolean);
  const score = (item: SourceItem) => {
    const title = tokens(item.title);
    const body = tokens(textOf(item));
    let s = 0;
    for (const p of ps) {
      const inTitle = hitsIn(title, p);
      const inBody = hitsIn(body, p);
      let v = 0;
      for (const a of p.anchors) v += inTitle.has(a) ? 3 : inBody.has(a) ? 1.5 : 0;
      for (const g of p.all) if (!p.anchors.includes(g) && positions(body, g).length) v += 1;
      if (p.whole.length > 4 && body.join(' ').includes(p.whole)) v += 3;
      s = Math.max(s, v);
    }
    // The angle the user asked for ("queer", "Lihaaf") beats a general piece about the subject.
    const bodyText = ` ${body.join(' ')} `;
    s += Math.min(3, focus.filter((f) => bodyText.includes(` ${f} `)).length) * 2.5;
    // Touching the case's subject (Tunguska, meteorite…) beats a bare name match.
    const around = new Set(tokens(textOf(item)).map(stem).filter((t) => ctx.has(t))).size;
    s += Math.min(around, 3) * 0.75;
    if (ROUNDUP.test(item.title)) s -= 4;
    if (SIDE_PAGE.test(item.title) && ![...wanted].some((w) => SIDE_PAGE.test(w))) s -= 3;
    return s;
  };
  return items
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
