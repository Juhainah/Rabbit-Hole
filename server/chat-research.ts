import type { SourceItem } from '../shared/types';
import { compactQuery, namesSubject, norm, rankRelevant, relevanceFilter, subjectName, terms } from './relevance';
import { availableSources, searchSource } from './sources';
import { archiveMedia, periodIn, siteIn, waybackImages } from './sources/archives';
import { wikiPrimary } from './sources/knowledge';
import { readAnything } from './reader';
import { understand } from './understand';
import { serper, serperImages, webSearch } from './sources/web';

// Words that say what to do, not what to look for.
const META_WORDS = new Set(
  ('yes yeah okay please connection connections connect link links linked relation related add pin note card cards board source sources photo photos picture pictures image images pics pic info information detail details anything something thing more show find bring tell explain give check work working api here there case clue clues about locate search fetch put them those these various including include forums forum like such ' +
    'strange stranger strangest weird weirdest odd oddest interesting important explanation happened happen think theory theories real fact facts evidence missing know story stories most best worst skeptic skeptics contradict contradicts summary summarize recap overlooked missed answer').split(' '),
);

const PICTURE = /\b(photos?|pictures?|pics?|images?|photographs?|maps?|scans?|footage|drawings?|paintings?|portraits?|screenshots?|faces?)\b/i;
const ARCHIVE = /\b(internet archive|archive\.org|archives?|archived)\b/i;
const AUDIO = /\b(audio|recordings?|recorded|broadcasts?|radio|podcasts?|interviews?|speech(es)?|sound|music|songs?|tapes?)\b/i;
const VIDEO = /\b(videos?|films?|footage|newsreels?|movies?|tv|television|clips?|documentar(y|ies))\b/i;
const FORUMS = /\b(reddit|forums?|threads?|discussions?|quora|4chan|people (say|said|think))\b/i;
// Lists and roundups share every name and explain none of them.
const ROUNDUP_TITLE = /^(list|lists|index|outline|glossary|timeline) of\b/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Whatever is ready by then; a slow archive never holds up the answer. */
const within = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), sleep(ms).then(() => fallback)]);

/**
 * What the chat searches with: the case's name plus the question's own subject words.
 * "people on the plane of the 9/11 attack, add pictures from reddit" on the 9/11 board
 * → "September 11 attacks plane passengers"-style searches, not the whole sentence.
 */
export function chatPhrase(question: string, hint?: string) {
  const lead = hint ? subjectName(hint) : '';
  const caseWords = new Set(hint ? terms(hint) : []);
  const own = question
    .replace(/[?!.,;:()"“”]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !META_WORDS.has(norm(w)) && !caseWords.has(norm(w)))
    .join(' ');
  const wordy = question.split(/\s+/).length > 5 || /^(can|could|would|please|show|bring|pin|put|add|find|give|tell|list|check|locate|what|whats|what's|why|how|who|when|where|which|is|are|was|were|did|do|does|has|have|any)\b/i.test(question);
  if (!wordy) return { phrase: question, lead };
  const phrase = compactQuery(own, lead ? 6 : 5, lead);
  return { phrase: phrase.trim() || lead || question, lead };
}

/**
 * The research behind one chat answer. Never takes longer than ~16 seconds: sources that
 * aren't back by then are left out rather than leaving the user watching "Checking the archives…".
 */
// Asking for things to be found or added: worth planning real searches for.
const FINDING = /\b(add|find|search|look|fetch|bring|get|pull|show|any|more|other|articles?|sources?|news|coverage|reviews?|interviews?|pictures?|photos?|images?|list|who|which)\b/i;

export async function chatResearch(
  question: string,
  hint: string | undefined,
  wanted: string[] | undefined,
  signal: AbortSignal,
  focus?: { url: string; title: string },
  extra: { searchFor?: string[]; onStatus?: (m: string) => void } = {},
): Promise<SourceItem[]> {
  const allowed = new Set(availableSources());
  const { phrase, lead } = chatPhrase(question, hint);
  const wantsImages = PICTURE.test(question);
  const wantsArchive = ARCHIVE.test(question);
  const wantsAudio = AUDIO.test(question);
  const wantsVideo = VIDEO.test(question);
  const wantsForums = FORUMS.test(question);
  const ids = [
    ...new Set([
      ...(wanted?.length ? wanted : ['wikipedia', 'web', 'reddit']),
      'web',
      'commons',
      ...(wantsForums ? ['reddit', 'forums'] : []),
      ...(wantsImages ? ['openverse', 'nasa'] : []),
    ]),
  ]
    .filter((id) => allowed.has(id))
    .slice(0, 9);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const site = siteIn(question) ?? siteIn(hint ?? '');
  const archived = site && (periodIn(question) || /\b(archive[ds]?|wayback|snapshot|old|back then|used to|original)\b/i.test(question) || wantsImages);
  const slow = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const mediaTask = within(
    Promise.all([
      wantsAudio || wantsArchive ? archiveMedia(phrase, 'audio', 4, slow).catch(() => []) : [],
      wantsVideo || wantsArchive ? archiveMedia(phrase, 'movies', 4, slow).catch(() => []) : [],
      wantsArchive ? searchSource('archive', phrase, { limit: 4, signal: slow }).catch(() => []) : [],
    ]).then((lists) => lists.flat()),
    16_000,
    [] as SourceItem[],
  );
  const waybackTask = archived ? within(waybackImages(site, periodIn(question), 8, slow), 16_000, [] as SourceItem[]) : Promise.resolve([] as SourceItem[]);
  // Google finds the page that answers a question; Google Images finds the pictures asked for.
  const googleTask = within(serper(phrase, 6, deadline).catch(() => webSearch(phrase, 5, deadline)), 13_000, [] as SourceItem[]);
  // Like a researcher: read the question against the first results, plan better searches, run them.
  // The partner's own follow-up searches ("ACTION: search …") are run as asked.
  const own = (extra.searchFor ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
  const plannedTask = (async () => {
    let qs = own;
    let names: string[] = [];
    if (!qs.length && FINDING.test(question)) {
      extra.onStatus?.('Planning the searches…');
      const plan = await understand(question, await googleTask, signal, hint);
      if (plan) {
        qs = plan.searches.slice(0, 3);
        names = [plan.subject, ...plan.aliases];
      }
    }
    if (!qs.length) return { items: [] as SourceItem[], names };
    extra.onStatus?.(`Searching the web: ${qs.map((q) => `“${q}”`).join(', ')}`);
    const lists = await Promise.all(
      qs.map((q, i) => within(i === 0 ? serper(q, 8, signal).then((r) => (r.length ? r : webSearch(q, 6, signal))) : webSearch(q, 6, signal), 12_000, [] as SourceItem[])),
    );
    return { items: lists.flat(), names };
  })();
  const imagesTask = wantsImages ? within(serperImages(phrase, 8, deadline), 13_000, [] as SourceItem[]) : Promise.resolve([] as SourceItem[]);
  // The card being asked about: its own page, read in full, and the pictures on it.
  const focusTask: Promise<SourceItem[]> = focus?.url && /^https?:/.test(focus.url) && !/\.(png|jpe?g|gif|webp)(\?|$)/i.test(focus.url)
    ? within(
        readAnything(focus.url).then((page) => {
          if (page.blocked || !page.text.trim()) return [];
          const site = /fandom\.com$/.test(new URL(focus.url).hostname) ? 'fandom' : 'web';
          const own: SourceItem = { id: `focus:${focus.url}`, source: site, kind: 'article', title: `${focus.title} (the card's own page)`, snippet: page.text.slice(0, 3000), url: focus.url, image: page.image };
          const pics = (page.images ?? []).slice(0, 12).map((src, i) => ({
            id: `focus-img:${src}`,
            source: site,
            kind: 'image' as const,
            title: decodeURIComponent(src.split('/').filter((p) => /\.(png|jpe?g|gif|webp)/i.test(p)).pop() ?? `Picture ${i + 1}`).replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').slice(0, 80),
            snippet: `On the page “${page.title}”`,
            url: focus.url,
            image: src,
          }));
          return [own, ...pics];
        }),
        10_000,
        [] as SourceItem[],
      )
    : Promise.resolve([]);
  const [primary, google, pictures, ...batches] = await Promise.all([
    within(wikiPrimary(phrase, deadline), 13_000, null),
    googleTask,
    imagesTask,
    ...ids.map((id) => within(searchSource(id, phrase, { limit: wantsImages && ['commons', 'openverse', 'nasa'].includes(id) ? 5 : 4, signal: deadline }), 13_000, [] as SourceItem[])),
  ]);
  // The main article must be about the case, and about something: not "List of Internet phenomena".
  const fits = (a: { title: string; extract: string }) =>
    !ROUNDUP_TITLE.test(a.title) && (!lead || namesSubject(lead, `${a.title} ${a.extract.slice(0, 1500)}`) || namesSubject(phrase, `${a.title} ${a.extract.slice(0, 1500)}`));
  const p = primary && fits(primary) ? primary : null;
  const topic = { phrasings: [phrase, lead || undefined, p?.title], context: p?.extract };
  const isRelevant = relevanceFilter(topic);
  // Lists and roundups are never the answer.
  const found = rankRelevant([...google, ...batches.flat()].filter((s) => !ROUNDUP_TITLE.test(s.title) && isRelevant(s)), topic);
  if (p) found.unshift({ id: `wikipedia:${p.title}`, source: 'wikipedia', kind: 'article', title: p.title, snippet: p.extract.slice(0, 600), url: p.url, image: p.image });
  const [fromArchive, media, fromCard, planned] = await Promise.all([waybackTask, mediaTask, focusTask, plannedTask]);
  // Searches the partner chose itself are trusted to be on point; planned ones must name the subject.
  const plannedTopic = { phrasings: [...planned.names, lead || undefined, phrase], context: p?.extract };
  const fromPlan = rankRelevant(
    planned.items.filter((s) => !ROUNDUP_TITLE.test(s.title) && (own.length > 0 || relevanceFilter(plannedTopic)(s))),
    { ...plannedTopic, phrasings: [...own, ...plannedTopic.phrasings] },
  );
  const playable = media.length ? rankRelevant(media.filter(isRelevant), topic) : [];
  // Pictures get the low numbers when pictures were asked for; threads come first when forums were.
  const threads = found.filter((s) => s.kind === 'post');
  const rest = found.filter((s) => s.kind !== 'post');
  const ordered = [
    ...fromCard,
    ...fromArchive,
    ...(wantsImages ? [] : fromPlan.slice(0, 8)),
    ...playable,
    ...(wantsImages ? [...pictures, ...rest.filter((s) => s.image)] : []),
    ...(wantsForums ? threads : []),
    ...(wantsImages ? [...fromPlan, ...rest.filter((s) => !s.image)] : rest),
    ...(wantsForums ? [] : threads),
  ];
  const seen = new Set<string>();
  return ordered.filter((s) => !seen.has(s.image ?? s.url ?? s.id) && seen.add(s.image ?? s.url ?? s.id));
}
