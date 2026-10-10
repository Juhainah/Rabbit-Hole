import type { SourceItem } from '../shared/types';
import { compactQuery, namesSubject, norm, rankRelevant, relevanceFilter, subjectName, terms } from './relevance';
import { availableSources, searchSource } from './sources';
import { archiveMedia, periodIn, siteIn, waybackImages } from './sources/archives';
import { wikiPrimary } from './sources/knowledge';
import { readAnything } from './reader';
import { understand } from './understand';
import { vetPictures } from './vision';
import { castOf, isGroup, isScreenWork } from './sources/cast';
import { findList, knownNames, setWords } from './research';
import { googleSearch, serperImages, webSearch } from './sources/web';

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
const ASKING = /\?|^(is|are|was|were|does|did|do|why|how|what|who|whom|when|where|which|could|would|should|has|have|had)\b/i;
/** Anime and manga: AniList knows the series and their characters. */
const ANIME = /\b(anime|manga|manhwa|manhua|light novel|isekai|shonen|shounen|shojo|shoujo|seinen|waifu|husbando|crunchyroll|myanimelist|anilist)\b/i;
/** Fan art and illustration: DeviantArt. */
const FAN_ART = /\b(fan ?art|fanart|deviantart|drawings?|illustrations?|artworks?|sketch(es)?|doodles?|cosplay)\b/i;
/** Design boards and inspiration: Pinterest, Behance, ArtStation, Dribbble. */
const DESIGN = /\b(pinterest|behance|artstation|dribbble|mood ?boards?|aesthetics?|inspo|inspiration|design ideas|concept art|portfolio)\b/i;

/** A request for a list of things or people in the subject. */
const LIST_REQUEST = /\b(list|lists|who'?s who|all (the|of)|every|full set|names of|characters|cast|members|boyfriends?|girlfriends?|villains|heroes|weapons|items|episodes|levels|recipes|dishes|keys|spells|monsters|cards)\b/i;

const FINDING = /\b(add|find|search|look|fetch|bring|get|pull|show|any|more|other|articles?|sources?|news|coverage|reviews?|interviews?|pictures?|photos?|images?|list|who|which)\b/i;

export async function chatResearch(
  question: string,
  hint: string | undefined,
  wanted: string[] | undefined,
  signal: AbortSignal,
  focus?: { url: string; title: string },
  extra: { searchFor?: string[]; onStatus?: (m: string) => void; earlier?: string; lastAsked?: string } = {},
): Promise<SourceItem[]> {
  const allowed = new Set(availableSources());
  // "Where is that article?" says nothing searchable: search with what it refers back to.
  const refersBack = !!extra.lastAsked && question.split(/\s+/).length <= 9 && /\b(that|this|it|its|those|these|them|they|there|the same|which one)\b/i.test(question);
  const { phrase, lead } = chatPhrase(refersBack ? `${extra.lastAsked} ${question}` : question, hint);
  const wantsImages = PICTURE.test(question);
  const wantsArchive = ARCHIVE.test(question);
  const wantsAudio = AUDIO.test(question);
  const wantsVideo = VIDEO.test(question);
  const wantsForums = FORUMS.test(question);
  const ids = [
    ...new Set([
      ...(wanted?.length ? wanted : ['wikipedia', 'web', 'reddit']),
      'web',
      // Fan and art sources, when the question is about them.
      ...(ANIME.test(`${question} ${hint ?? ''}`) ? ['anilist'] : []),
      ...(FAN_ART.test(question) ? ['deviantart'] : []),
      ...(DESIGN.test(question) ? ['design'] : []),
      ...(wantsForums ? ['reddit', 'forums'] : []),
      ...(wantsImages ? ['commons', 'openverse', 'nasa'] : []),
    ]),
  ]
    .filter((id) => allowed.has(id))
    .slice(0, 10);
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
  // Archived pictures have file numbers for names: an AI that can see checks each one shows what was asked for.
  const waybackTask = archived
    ? within(
        waybackImages(site, periodIn(question), 10, slow, terms(question)).then((imgs) => vetPictures(imgs, [hint, question].filter(Boolean).join(' — '), signal, { keepUnseen: () => false, ms: 14_000 })),
        24_000,
        [] as SourceItem[],
      )
    : Promise.resolve([] as SourceItem[]);
  // Google finds the page that answers a question; Google Images finds the pictures asked for.
  const googleTask = within(googleSearch(phrase, 6, deadline).then((r) => (r.length ? r : webSearch(phrase, 5, deadline))).catch(() => webSearch(phrase, 5, deadline)), 13_000, [] as SourceItem[]);
  // Like a researcher: read the question against the first results, plan better searches, run them.
  // The partner's own follow-up searches ("ACTION: search …") are run as asked.
  const own = (extra.searchFor ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
  const plannedTask = (async () => {
    let qs = own;
    let names: string[] = [];
    // Questions ("Is the Begum's marriage portrayed as a sham…?") are researched, not answered from memory.
    if (!qs.length && (refersBack || FINDING.test(question) || ASKING.test(question.trim()) || question.split(/\s+/).length >= 6)) {
      extra.onStatus?.('Planning the searches…');
      const plan = await understand(question, await googleTask, signal, hint, extra.earlier);
      if (plan) {
        qs = plan.searches.slice(0, 3);
        names = [plan.subject, ...plan.aliases];
      }
    }
    if (!qs.length) return { items: [] as SourceItem[], names };
    extra.onStatus?.(`Searching the web: ${qs.map((q) => `“${q}”`).join(', ')}`);
    const lists = await Promise.all(
      qs.map((q, i) => within(i === 0 ? googleSearch(q, 8, signal).then((r) => (r.length ? r : webSearch(q, 6, signal))) : webSearch(q, 6, signal), 12_000, [] as SourceItem[])),
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
  // A film or series on the board: who plays whom, so "list the leads and their characters" can be answered.
  const castTask = p && (isScreenWork(p.extract) || isGroup(p.extract)) ? within(castOf(p.title, signal), 9000, null) : Promise.resolve(null);
  // Asked for a list ("the boyfriends", "all the keys", "who's who"): the subject's fan wiki keeps it, with
  // pictures, and needs no web search. Looked up as soon as the subject is known.
  const listTask: Promise<SourceItem[]> = LIST_REQUEST.test(question)
    ? plannedTask.then(async (pl) => {
        // A question asked on a board is about its case: when the question's own subject is just the thing asked
        // for ("boyfriends"), the subject is the case's, read from its name the way a dig reads a search.
        let subject = pl.names[0] || (p ? p.title : '');
        const askedNouns = setWords(question, '');
        const isTheThing = !subject || askedNouns.some((w) => terms(subject).some((t) => t === w || t === w.replace(/s$/, '') || `${t}s` === w));
        if (isTheThing && hint) {
          const known = await within(knownNames(hint, signal), 8_000, [] as SourceItem[]);
          const ofCase = await within(understand(hint, known, signal), 12_000, null);
          subject = ofCase?.subject ?? subjectName(hint);
        }
        if (!subject) subject = subjectName(hint ?? question);
        if (!subject) return [];
        const what = question.replace(/[?!.,]/g, ' ').replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ').replace(/\s+/g, ' ').trim();
        extra.onStatus?.(`Looking for the list on the ${subject} fan wiki…`);
        // The thing asked for ("boyfriends", "keys"), not every word of the question ("game" would match "Games").
        const asked = setWords(question, subject);
        const g = await within(findList(subject, asked.length ? asked.join(' ') : what || question, signal), 25_000, undefined);
        if (!g?.items.length) return [];
        const names = g.items.slice(0, 40).map((it) => (it.meta?.role ? `${it.title} (${it.meta.role})` : it.title));
        return [
          {
            id: `wiki-list:${g.url}`,
            source: g.source === 'web' ? 'web' : g.source,
            kind: 'article' as const,
            title: `LIST FOUND: ${g.label} — ${g.title} (${g.items.length} on ${g.wiki})`,
            snippet: `${names.join('; ')}. To pin it as a list card: ACTION: list ${g.label} from ${subject}`,
            url: g.url,
            image: g.items.find((it) => it.image)?.image,
          },
        ];
      })
    : Promise.resolve([]);
  const [fromArchive, media, fromCard, planned, cast, listFound] = await Promise.all([waybackTask, mediaTask, focusTask, plannedTask, castTask, listTask.catch(() => [] as SourceItem[])]);
  const castSource: SourceItem[] = cast
    ? [{ id: `cast-list:${cast.title}`, source: 'wikipedia', kind: 'article', title: `${cast.label === 'Cast & crew' ? 'Cast' : cast.label} of ${cast.title}`, url: cast.url, snippet: [cast.director.length ? `Directed by ${cast.director.join(', ')}.` : '', ...cast.items.map((it) => (it.meta?.role ? `${it.title} as ${it.meta.role}` : it.title))].filter(Boolean).join('; ') }]
    : [];
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
    ...listFound,
    ...fromCard,
    ...castSource,
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
