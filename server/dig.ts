import type { Analysis, DigEvent, DigRequest, Primary, SourceItem } from '../shared/types';
import { errMsg, sleep } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';
import { digMessages, normalizeAnalysis, normalizeTangents, tangentMessages } from './prompts';
import { checkPremise, compactQuery, editDistance, namesSubject, norm, rankRelevant, relevanceFilter, saysName, subjectName, subjectWords, terms, touches } from './relevance';
import { googleSearch, serperImages, webSearch } from './sources/web';
import { deepResearch, knownNames, wikiPictures, type Research } from './research';
import { understand, type Understanding } from './understand';
import { ogImage, primaryFromUrl } from './scrape';
import { availableSources, searchSource } from './sources';
import { archiveMedia, siteIn, waybackImages } from './sources/archives';
import { nameMatcher, norm as nameKey, tokenize } from '../shared/names';
import { enrichEntities, wikiPrimary } from './sources/knowledge';
import { castOf, isGroup, isScreenWork, type Cast } from './sources/cast';
import { keyDates, type KeyDate } from './sources/keydates';
import { needsLooking, vetPictures } from './vision';

export type Emit = (ev: DigEvent) => void;

// Sources whose pages rarely carry a useful share image (or can't be fetched).
const NO_PAGE_IMAGES = new Set([
  'googlenews', 'reddit', 'openalex', 'arxiv', 'crossref', 'europepmc', 'semanticscholar', 'zenodo', 'oeis',
  'wikidata', 'wiktionary', 'urbandictionary', 'sec', 'fedregister', 'courtlistener', 'wayback', 'musicbrainz',
]);

/** Does the Wikipedia hit actually match the topic, or did search wander off? */
/** The main article has to be about the subject, not just share a word like "theory" with it. */
function primaryMatches(query: string, p: Primary, isName = false) {
  const opening = p.extract.slice(0, 1500);
  if (!namesSubject(query, `${p.title} ${opening}`)) return false;
  // A name of a few words has to appear as itself: an article on a bakery chain mentions a bakery and a story,
  // not the game called "Bakery Story"; a song called "Alice's Restaurant" is not "Restaurant Story".
  const n = query.trim().split(/\s+/).length;
  if (!isName || n < 2 || n > 5) return true;
  const squash = (t: string) => norm(t).replace(/[^\p{L}\p{N}]+/gu, '');
  return saysName(query, p.title) || squash(p.title).includes(squash(query)) || saysName(query, opening);
}

/** Long questions search badly. "why did the hikers die in 1959" searches better as "Dyatlov Pass incident". */
/** What the archives are searched with: a short phrase they can match, not a sentence. */
function searchPhrase(query: string, primary: Primary | null) {
  const question = /\?|^(why|how|what|who|when|where|was|did|is|are)\b/i.test(query);
  if (question && primary) return primary.title;
  return query.split(/\s+/).length > 4 ? compactQuery(query, 4) : query;
}

/**
 * One "dig": find the main article, fan out to every chosen source in parallel
 * (streaming relevant results to the board as they land), then have the AI map
 * the evidence into entities, strings, a timeline and new rabbit holes.
 */
// Sites that host other things: the subject is in the title or path, not the domain.
const HOSTS = /(^|\.)(archive\.org|wikipedia\.org|youtube\.com|youtu\.be|reddit\.com|github\.com|x\.com|twitter\.com|facebook\.com|instagram\.com|tiktok\.com|medium\.com|substack\.com|google\.com)$/;

/**
 * What a link is about, as a search: "archive.org/details/rotten_com_master"
 * (titled "Rotten.com Source Code/Mirror") is about rotten.com; a site's home
 * page is about the site; any other page is about its title.
 */
export function topicFromUrl(url: string, title?: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return title || url;
  }
  const host = u.hostname.replace(/^www\./, '');
  const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.(s?html?|php|aspx?)$/i, '');
  if (HOSTS.test(host)) {
    // A site named in the title or path wins: "Rotten.com Source Code/Mirror" → rotten.com.
    const named = siteIn(`${title ?? ''} ${slug.replace(/_(com|org|net)\b/gi, '.$1')}`);
    if (named) return named;
    return title || slug.replace(/[_+-]+/g, ' ').trim() || host;
  }
  if (!slug || /^(index|home|default|main)$/i.test(slug)) return host;
  return title || slug.replace(/[_+-]+/g, ' ');
}

// Sources whose search understands "subject + case" as one question (news, forums, video, the web).
// Store, download and profile pages: background, never the evidence that tells a story.
const LOW_VALUE = /(uptodown|apkpure|apkmirror|apkcombo|softonic|bluestacks|soft112|filehippo|malavida|ldplayer|appbrain|apps\.apple\.com|play\.google\.com|instagram\.com|facebook\.com|vk\.(com|ru)|pinterest\.|tiktok\.com|linkedin\.com)/i;
const STORY_SOURCES = new Set(['web', 'reddit', 'forums', 'lemmy', 'hackernews', 'youtube', 'googlenews', 'gdelt', 'podcasts', 'dailymotion', 'archive', 'declassified', 'courtlistener', 'lostmedia', 'atlasobscura', 'fandom']);

const CHECKED_KINDS = new Set(['person', 'place', 'org']);

/**
 * Drops people, places and organisations that no source names. The AI is fluent
 * and sometimes wrong ("Talking Angela, by ZeptoLab, of Istanbul"); a card on the
 * board should be something the evidence actually mentions. Returns what was dropped.
 */
function groundEntities(analysis: Analysis, primary: Primary | null, evidence: SourceItem[], alsoRead = ''): string[] {
  const read = [primary?.title, primary?.extract, alsoRead, ...evidence.map((e) => `${e.title} ${e.snippet ?? ''} ${e.author ?? ''}`)].filter(Boolean).join(' \n ');
  const corpus = tokenize(read);
  if (corpus.length < 80) return []; // too little was read to judge
  const words = [...new Set(corpus.filter((w) => w.length >= 5))];
  // Respell a name to the way the sources write it, one slip per word ("Chugtai" → "Chughtai").
  const respell = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => {
        const k = nameKey(w).replace(/[^\p{L}\p{N}]/gu, '');
        if (k.length < 5 || corpus.includes(k)) return w;
        const near = words.find((c) => Math.abs(c.length - k.length) <= 1 && editDistance(c, k) <= 1);
        return near ? near[0].toUpperCase() + near.slice(1) : w;
      })
      .join(' ');
  for (const e of analysis.entities) {
    if (!CHECKED_KINDS.has(e.type) || nameMatcher(e.name, e.type === 'person')(corpus)) continue;
    const fixed = respell(e.name);
    if (fixed !== e.name && nameMatcher(fixed, e.type === 'person')(corpus)) {
      for (const r of analysis.relations) {
        if (r.from === e.name) r.from = fixed;
        if (r.to === e.name) r.to = fixed;
      }
      e.name = fixed;
    }
  }
  const dropped = analysis.entities.filter((e) => CHECKED_KINDS.has(e.type) && !nameMatcher(e.name, e.type === 'person')(corpus));
  // Never strip a case bare.
  if (!dropped.length || analysis.entities.length - dropped.length < 3) return [];
  const gone = new Set(dropped.map((e) => nameKey(e.name)));
  analysis.entities = analysis.entities.filter((e) => !gone.has(nameKey(e.name)));
  analysis.relations = analysis.relations.filter((r) => !gone.has(nameKey(r.from)) && !gone.has(nameKey(r.to)));
  return dropped.map((e) => e.name);
}

/** Platforms where a case is discussed. Digging deeper on one means "what people there say about the case". */
const VENUES: { re: RegExp; name: string; source?: string; site: string }[] = [
  { re: /^(reddit|r\/\w+|subreddits?)$/i, name: 'Reddit', source: 'reddit', site: 'reddit.com' },
  { re: /^(youtube|youtube channel)$/i, name: 'YouTube', source: 'youtube', site: 'youtube.com' },
  { re: /^quora$/i, name: 'Quora', site: 'quora.com' },
  { re: /^tik ?tok$/i, name: 'TikTok', site: 'tiktok.com' },
  { re: /^(twitter|x|x \(twitter\))$/i, name: 'X (Twitter)', site: 'x.com' },
  { re: /^(4chan|\/x\/|4chan \/x\/)$/i, name: '4chan', site: 'archive.4plebs.org' },
  { re: /^facebook$/i, name: 'Facebook', site: 'facebook.com' },
  { re: /^tumblr$/i, name: 'Tumblr', site: 'tumblr.com' },
  { re: /^hacker news$/i, name: 'Hacker News', source: 'hackernews', site: 'news.ycombinator.com' },
  { re: /^lemmy$/i, name: 'Lemmy', source: 'lemmy', site: 'lemmy.world' },
];

const listWords = (ws: string[]) => ws.map((w) => `“${w}”`).join(ws.length > 2 ? ', ' : ' or ');

export async function runDig(req: DigRequest, emit: Emit, signal: AbortSignal) {
  const topic = String(req.topic ?? '').trim().slice(0, 200);
  if (!topic && !req.url) throw new Error('Nothing to dig into.');
  const allowed = new Set(availableSources());
  const sources = [...new Set(req.sources ?? [])].filter((id) => allowed.has(id)).slice(0, 24);
  const per = Math.min(6, Math.max(1, req.perSource ?? 3));
  const trail = (req.trail ?? []).slice(-6).map((t) => String(t).slice(0, 120));

  emit({ type: 'status', message: `Opening a case file on “${topic || req.url}”` });

  let primary: Primary | null = null;
  if (req.url) {
    emit({ type: 'status', message: 'Reading the link…' });
    primary = await primaryFromUrl(req.url).catch((e) => {
      emit({ type: 'status', message: `Couldn't read that link: ${errMsg(e)}`, level: 'warn' });
      return null;
    });
  }
  const asked = topic || topicFromUrl(req.url!, primary?.title);
  const caseQuery = req.caseQuery?.trim().slice(0, 120);

  // Check the search against what the web actually says before digging: typos are read as the word the
  // results use, and a name no result connects to the rest is flagged instead of built into the case.
  const notes: string[] = [];
  let query = asked;
  let scout: SourceItem[] = [];
  let u: Understanding | null = null;
  const toVenue = !!caseQuery && VENUES.some((v) => v.re.test(asked.trim()));
  if (topic && !toVenue) {
    emit({ type: 'status', message: 'Reading your search…' });
    // Google knows how things are spelled and what exists; the first results show the AI both.
    const scoutQ = caseQuery && !norm(asked).includes(norm(caseQuery)) ? `${asked} ${caseQuery}` : asked;
    // What fan wikis and Wikipedia know by that name ("Animoca Star Girl Wiki: a mobile game by…") is read
    // alongside the first web results: a weak engine's guesses then can't outvote what the thing really is.
    const [web0, known0] = await Promise.all([
      Promise.race([
        googleSearch(scoutQ, 8, signal).then((r) => (r.length ? r : webSearch(scoutQ, 6, signal))).catch(() => webSearch(scoutQ, 6, signal).catch(() => [] as SourceItem[])),
        sleep(7000).then(() => [] as SourceItem[]),
      ]),
      Promise.race([knownNames(scoutQ, signal), sleep(6000).then(() => [] as SourceItem[])]),
    ]);
    scout = [...known0.slice(0, 4), ...web0];
    u = await understand(asked, scout, signal, caseQuery);
    // The first results were about something else (a weak engine's guess): read the search again from
    // what fan wikis and Wikipedia know by that name, and keep those results instead of the junk.
    if (!u && scout.length) {
      const known = await Promise.race([knownNames(scoutQ, signal), sleep(6000).then(() => [] as SourceItem[])]);
      if (known.length) {
        u = await understand(asked, known, signal, caseQuery);
        scout = known;
      }
    }
    if (process.env.RH_DEBUG) console.log('[understand]', JSON.stringify(u));
  }
  if (u && caseQuery) {
    // The card's name with the spelling fixed, word by word.
    const fixed = asked
      .split(/\s+/)
      .map((w) => u!.fixes[w] ?? u!.fixes[w.toLowerCase()] ?? w)
      .join(' ');
    // The AI's spelling only when it keeps every typed word: "carbon dating" never shrinks back to the case.
    const card = namesSubject(fixed, u.subject) ? u.subject : fixed;
    u = {
      ...u,
      subject: card,
      query: card,
      aliases: u.aliases.filter((a) => namesSubject(card, a) || namesSubject(a, card)),
      // Searches for the card in the case: each must name the card.
      searches: u.searches.filter((s) => namesSubject(card, s)),
    };
  }
  if (u) {
    for (const [typo, word] of Object.entries(u.fixes)) notes.push(`Read “${typo}” as “${word}”.`);
    if (u.doubt) notes.push(u.doubt);
    query = u.query;
    if (notes.length) emit({ type: 'status', message: `⚠ ${notes.join(' ')} This case follows “${query}”.`, level: 'warn' });
  } else if (topic && !caseQuery && !req.trail?.length) {
    if (!scout.length) scout = await Promise.race([webSearch(asked, 6, signal).catch(() => [] as SourceItem[]), sleep(6000).then(() => [] as SourceItem[])]);
    const check = checkPremise(asked, scout);
    for (const [typo, word] of Object.entries(check.typos)) notes.push(`Read “${typo}” as “${word}”.`);
    if (check.unknown.length) notes.push(`No source found mentions ${listWords(check.unknown)}.`);
    if (check.unlinked.length) notes.push(`Sources mention ${listWords(check.unlinked)}, but never together with the rest of the search.`);
    if (check.focus !== norm(asked).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()) query = check.focus;
    if (notes.length) emit({ type: 'status', message: `⚠ ${notes.join(' ')} This case follows “${query}”.`, level: 'warn' });
  }

  const framed = caseQuery && !norm(query).includes(norm(caseQuery)) && !norm(caseQuery).includes(norm(query)) ? caseQuery : undefined;
  const venue = framed ? VENUES.find((v) => v.re.test(query.trim())) : undefined;

  if (!primary && !venue) {
    // The main article comes first (about a second) because it sharpens every other search.
    // The subject's own article ("Dedh Ishqiya"), not one about the angle ("LGBTQ rights in India").
    const lookup = u?.subject ?? query;
    primary = await Promise.race([wikiPrimary(lookup, signal).catch(() => null), sleep(4500).then(() => null)]);
    if (primary && !primaryMatches(lookup, primary, !!u?.subject)) primary = null;
    // "Talking Angela conspiracy theories" can land on a broader article; look the name up on its own.
    const name = subjectWords(query).join(' ');
    if (name && name !== norm(query) && (!primary || !namesSubject(name, primary.title))) {
      const alt = await Promise.race([wikiPrimary(name, signal).catch(() => null), sleep(3500).then(() => null)]);
      if (alt && primaryMatches(name, alt, true)) primary = alt;
    }
  }
  // In a deeper dig, the general article ("Reddit", "FBI") is only the main article if it mentions the case.
  if (primary && framed && !req.url && !namesSubject(framed, `${primary.title} ${primary.extract}`)) primary = null;
  if (primary) emit({ type: 'primary', primary });
  // The subject's checked dates (released, first aired, awards, founded, ended): the timeline's backbone.
  const keyDatesTask: Promise<KeyDate[]> = primary && !framed ? keyDates(primary.title, signal).catch(() => []) : Promise.resolve([]);

  const phrase = u ? u.query : searchPhrase(query, primary);
  // A link's page title can be incidental ("Rotten.com Source Code/Mirror"); only a typed topic's article title helps judge results.
  // A narrower dig ("Voynich manuscript carbon dating") can land on the case's own article; that title would let
  // anything about the whole case through, so it only helps when it names something more specific.
  const caseWords = new Set(caseQuery ? terms(caseQuery) : []);
  const primaryIsCase = !!primary && caseWords.size > 0 && terms(primary.title).every((w) => caseWords.has(w));
  const titleHelps = topic && !primaryIsCase ? primary?.title : undefined;
  const mentionsCase = framed ? relevanceFilter({ phrasings: [framed] }) : () => true;
  // A venue dig judges results by the case alone: Reddit threads about Star Girl rarely say "Reddit".
  // What the case is about, in its own words: the main article, else the first results that name it.
  const scoutText = primary ? '' : scout.filter((s) => namesSubject(subjectName(query), `${s.title} ${s.snippet ?? ''}`)).map((s) => `${s.title}. ${s.snippet ?? ''}`).join(' ');
  // Understood: a result must name the subject (or another name for it); the angle ranks it higher.
  // "Stargirl" is not another name for "Star Girl": it is how its namesakes (a novel, a DC hero) are spelled.
  const squash = (x: string) => norm(x).replace(/[^\p{L}\p{N}]/gu, '');
  const aliases = u ? u.aliases.filter((a) => squash(a) !== squash(u!.subject)) : [];
  const names = u ? [u.subject, ...aliases] : [query];
  const topicOf = { phrasings: venue ? [framed] : [...names, titleHelps], context: [framed, primary?.extract ?? scoutText].filter(Boolean).join('. '), focus: u?.focus };
  /** Searches that understand "subject + case" get both; reference works get the subject alone. */
  const phraseFor = (id: string) => (framed && STORY_SOURCES.has(id) ? `${phrase} ${framed}` : phrase);
  /** The case's own name, for sources that match titles ("star girl" as one phrase). */
  const subject = u?.subject ?? subjectName(framed ?? query);
  // Words the first results keep using besides the name (its maker, its platform): they tell this case
  // from namesakes on sites that match by title.
  const sideWords = (() => {
    const own = new Set(terms(subject));
    const count = new Map<string, number>();
    for (const it of scout) for (const w of new Set(terms(`${it.title} ${it.snippet ?? ''} ${(it.url ?? '').replace(/[/._-]+/g, ' ')}`))) if (w.length >= 5 && !own.has(w) && !/^(https?|www|com|html|wiki|fandom|reddit|youtube|watch|games?|android|apps?|store|official|download)$/.test(w)) count.set(w, (count.get(w) ?? 0) + 1);
    // The other names it goes by ("Animoca Star Girl") say best what it is.
    const fromAliases = (u?.aliases ?? []).flatMap((a) => terms(a)).filter((w) => w.length >= 4 && !own.has(w));
    const fromResults = [...count].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w);
    return [...new Set([...fromAliases, ...fromResults])].slice(0, 3);
  })();
  /** Names the search mentioned that sources never tie in: still searched where people talk, in case a link exists. */
  const storyExtra = !u && query !== asked && !framed ? asked : undefined;
  /** In a framed dig, results that tie back to the case come first; generic background gets one slot. */
  const framedPick = (items: SourceItem[], n: number, general = 1) =>
    framed ? [...items.filter(mentionsCase), ...items.filter((it) => !mentionsCase(it)).slice(0, general)].slice(0, n) : items.slice(0, n);
  const isRelevant = relevanceFilter(topicOf);

  // Deep research runs alongside the sources: planned searches, the subject's wiki, pages read in full.
  const researchTopic = framed ? `${query} ${framed}` : query;
  const researchTask: Promise<Research | null> = venue
    ? Promise.resolve(null)
    : (async () => {
        const sc = scout.length ? scout : await Promise.race([webSearch(researchTopic, 6, signal).catch(() => [] as SourceItem[]), sleep(6000).then(() => [] as SourceItem[])]);
        return deepResearch(researchTopic, sc, isRelevant, signal, (message) => emit({ type: 'status', message }), u ? { subject: u.subject, queries: u.searches, sites: u.sites, focus: u.focus } : undefined);
      })().catch((e) => {
        console.warn(`[research] ${errMsg(e)}`);
        return null;
      });
  // Who's who for any work, band, group or organisation; and for a work of the same name the article links
  // (the series a band was formed for), its cast too.
  const castTask: Promise<Cast[]> =
    primary && (isScreenWork(primary.extract) || isGroup(primary.extract)) && !venue
      ? castOf(primary.title, signal)
          .then(async (c) => {
            if (!c) return [];
            const sib = c.siblings[0] ? await castOf(c.siblings[0], signal).catch(() => null) : null;
            return [c, ...(sib?.items.length ? [sib] : [])].filter((x) => x.items.length >= 2);
          })
          .catch(() => [])
      : Promise.resolve([]);
  const seen = new Set<string>();
  const keep = (items: SourceItem[]) =>
    items.filter((it) => {
      const yt = it.media?.type === 'youtube' ? it.media.src : it.url?.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/)?.[1];
      const key = yt ? `yt:${yt}` : (it.url ?? it.id).replace(/[?#].*$/, '').replace(/\/$/, '');
      if (seen.has(key) || !isRelevant(it)) return false;
      seen.add(key);
      return true;
    });

  const evidence: SourceItem[] = [];
  /** Archive pictures being looked at before they are pinned. */
  let lookTask: Promise<void> = Promise.resolve();
  /** Photos and recordings pinned outside the main evidence (their titles still count as read). */
  const sideItems: SourceItem[] = [];
  let dropped = 0;
  // A venue dig searches that venue for the case; any other dig searches every chosen source.
  const plan: { id: string; run: () => Promise<SourceItem[]> }[] = venue
    ? [
        ...(venue.source && allowed.has(venue.source) ? [{ id: venue.source, run: () => searchSource(venue.source!, framed!, { limit: 8, signal }) }] : []),
        {
          id: 'web',
          run: async () =>
            (await webSearch(`${framed} site:${venue.site}`, 8, signal))
              .filter((it) => it.url?.includes(venue.site))
              .map((it) => ({ ...it, kind: 'post' as const, source: venue.source ?? 'forums', meta: { sub: venue.name } })),
        },
      ]
    : sources.map((id) => ({ id, run: () => searchSource(id, STORY_SOURCES.has(id) && storyExtra ? storyExtra : phraseFor(id), { limit: per + 3, signal, subject, context: sideWords }) }));
  const tasks = plan.map(async ({ id, run }) => {
    emit({ type: 'source-start', source: id });
    try {
      // Ask for extra, since the relevance filter may throw some away.
      const raw = await run();
      // Best matches first, so the few slots per source go to the strongest evidence.
      const relevant = rankRelevant(keep(raw), { ...topicOf, phrasings: [phrase, titleHelps] });
      const items = framedPick(relevant, venue ? 8 : per, id === 'wikipedia' ? 1 : 0);
      dropped += raw.length - relevant.length;
      if (process.env.RH_DEBUG && ['reddit', 'forums', 'youtube'].includes(id)) console.log('[source]', id, JSON.stringify(phraseFor(id)), raw.map((r) => r.title.slice(0, 50)), '→', items.map((r) => r.title.slice(0, 50)));
      evidence.push(...items);
      emit({ type: 'source', source: id, items });
    } catch (e) {
      if (!signal.aborted) emit({ type: 'source-error', source: id, error: errMsg(e) });
    }
  });

  // A dedicated photo pass, so every board gets real pictures, not just text.
  const photoTask: Promise<SourceItem[]> = (async () => {
    const ids = ['commons', 'openverse'].filter((id) => allowed.has(id));
    // A website as the subject: its own pictures, as the Wayback Machine saved them.
    const site = siteIn(query);
    const batches = await Promise.allSettled([
      ...ids.map((id) => searchSource(id, phrase, { limit: id === 'commons' ? 8 : 5, signal })),
      ...(site ? [waybackImages(site, undefined, 8, signal, [...(u?.focus ?? []).flatMap(terms), ...terms(query)].filter((w) => !terms(site).includes(w)))] : []),
      // Google Images: the posters, stills, screenshots and faces the archives rarely hold.
      serperImages(u?.query ?? phrase, 8, signal).then((r) => r.filter((it) => !/fandom\.com|pinterest\.|instagram\.com|spotify\.com|apple\.com\/.*music|gettyimages|shutterstock|alamy|istockphoto|dreamstime/i.test(it.url ?? '') && namesSubject(subject, `${it.title} ${it.meta?.site ?? ''}`)).slice(0, 4)),
    ]);
    const items = rankRelevant(keep(batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : [])).filter((it) => it.image)), { ...topicOf, phrasings: [phrase, titleHelps] });
    return venue ? [] : framedPick(items, 8, 0);
  })().catch(() => []);

  // And a pass for things to listen to and watch: old broadcasts, oral histories, newsreels, podcasts.
  const mediaTask = (async () => {
    const batches = await Promise.allSettled([
      archiveMedia(phraseFor('archive'), 'audio', 5, signal),
      archiveMedia(phraseFor('archive'), 'movies', 5, signal),
      allowed.has('podcasts') ? searchSource('podcasts', phrase, { limit: 4, signal }) : Promise.resolve([]),
    ]);
    const [audio, films, pods] = batches.map((b) => (b.status === 'fulfilled' ? rankRelevant(keep(b.value), { ...topicOf, phrasings: [phrase, titleHelps] }) : []));
    // In a deeper dig, recordings must be about this case (a namesake podcast is not).
    const inCase = (xs: SourceItem[]) => (framed ? xs.filter(mentionsCase) : xs);
    const items = [...inCase(audio).slice(0, 2), ...inCase(films).slice(0, 2), ...inCase(pods).slice(0, 2)];
    sideItems.push(...items);
    if (items.length && !signal.aborted) emit({ type: 'media', items });
  })();

  // Slow sources keep streaming in, but the AI doesn't wait on them forever.
  await Promise.race([Promise.allSettled(tasks), sleep(18000)]);
  if (signal.aborted) return;
  if (!signal.aborted) emit({ type: 'status', message: 'Finishing the deep research…' });
  // With little found so far (a niche topic, or web search out of allowance), the wiki research is the case:
  // give it longer before saying nothing turned up.
  const thin = evidence.length + (primary ? 2 : 0) < 4;
  const research = await Promise.race([researchTask, sleep(thin ? 55000 : 30000).then(() => null)]);
  // A film, series, band or group: who is in it (and who they play), as who's-who cards.
  const casts = await Promise.race([castTask, sleep(3000).then(() => [] as Cast[])]);
  const castReading = casts.map((cast) => ({
    title: `${cast.label === 'Cast & crew' ? 'Cast' : cast.label} of ${cast.title} (Wikipedia)`,
    url: cast.url,
    source: 'wikipedia',
    text: [cast.director.length ? `Directed by ${cast.director.join(', ')}.` : '', ...cast.items.map((it) => (it.meta?.role ? `${it.title} as ${it.meta.role}` : it.title))].filter(Boolean).join('\n'),
  }));
  for (const cast of signal.aborted ? [] : casts) {
    sideItems.push(...cast.items);
    emit({ type: 'gallery', gallery: { title: `Who's who in ${cast.title}`, label: cast.label, url: cast.url, source: 'wikipedia', items: cast.items, note: cast.director.length ? `Directed by ${cast.director.join(', ')}` : undefined } });
  }
  if (signal.aborted) return;
  {
    const fromArchives = await Promise.race([photoTask, sleep(4000).then(() => [] as SourceItem[])]);
    const seenPhotos = new Set<string>();
    // In a deeper dig, archive pictures must name what is being dug into (not just share the case's words).
    const archivePics = framed ? fromArchives.filter((p) => namesSubject(subject, `${p.title} ${p.snippet ?? ''}`)) : fromArchives;
    const all = [...(research?.photos ?? []), ...archivePics].filter((p) => p.image && !seenPhotos.has(p.image) && seenPhotos.add(p.image));
    // Pictures whose names say what they show go up now; nameless ones (archive file numbers) are
    // looked at first by an AI that can see, and pinned only if they show what this dig is about.
    const photos = all.filter((p) => !needsLooking(p)).slice(0, 6);
    const unsure = all.filter(needsLooking).slice(0, 12);
    sideItems.push(...photos);
    if (photos.length && !signal.aborted) emit({ type: 'photos', items: photos });
    if (unsure.length && photos.length < 6) {
      const about = [u?.query ?? query, framed].filter(Boolean).join(' — ');
      emit({ type: 'status', message: `Looking at ${unsure.length} picture${unsure.length === 1 ? '' : 's'} before pinning them…` });
      lookTask = vetPictures(unsure, about, signal, { keepUnseen: () => false, ms: 25_000 }).then((ok) => {
        const pin = ok.slice(0, 6 - photos.length);
        sideItems.push(...pin);
        if (pin.length && !signal.aborted) emit({ type: 'photos', items: pin });
        const left = unsure.length - ok.length;
        if (left > 0 && !signal.aborted) emit({ type: 'status', message: `Looked at ${unsure.length} picture${unsure.length === 1 ? '' : 's'} and left off ${left} that didn't show what you searched for` });
      });
    }
  }
  if (research) {
    // The research finds go on the board like any other evidence, grouped by where they came from.
    // In a deeper dig, research that ties the card to the case comes first; plain background gets two slots.
    const fresh = framed ? framedPick(keep(research.items), 12, 1) : keep(research.items);
    evidence.unshift(...fresh);
    const bySource = new Map<string, SourceItem[]>();
    for (const it of fresh) bySource.set(it.source, [...(bySource.get(it.source) ?? []), it]);
    for (const [source, items] of bySource) emit({ type: 'source', source, items, limit: items.length });
    // In a deeper dig, only a list about the card itself (not the whole case's albums or characters).
    const ownList = (g: NonNullable<typeof research.gallery>) => !framed || namesSubject(subject, `${g.title} ${g.about ?? ''} ${g.label ?? ''}`);
    if (research.gallery && ownList(research.gallery)) emit({ type: 'gallery', gallery: { ...research.gallery, source: 'fandom' } });
    for (const g of framed ? [] : (research.more ?? [])) emit({ type: 'gallery', gallery: { ...g, source: 'fandom' } });
    // Results let in only for naming the subject ("Star Girl: Cosmic Conversations", another app) must also
    // touch what this case's own sources talk about (Animoca, Boyfriends, SimSimi); namesakes don't.
    const vocabulary = new Set(research.vocabulary);
    if (vocabulary.size >= 5 && !venue) {
      const strict = relevanceFilter({ ...topicOf, strict: true });
      const own = new Set([...vocabulary, ...aliases.flatMap(terms), ...(framed ? terms(framed) : []), ...terms(query).filter((w) => !terms(subject).includes(w))]);
      const home = subject.replace(/\s+/g, '').toLowerCase();
      const namesakes = evidence.filter((it) =>
        it.source === 'fandom' ? false
        : framed && !mentionsCase(it) ? !touches(it, own)
        : it.kind === 'post' ? !touches(it, own) && !String(it.meta?.sub ?? '').toLowerCase().includes(home)
        : !strict(it) && !touches(it, vocabulary),
      );
      if (namesakes.length && namesakes.length < evidence.length / 2) {
        const out = new Set(namesakes.map((it) => it.id));
        for (let i = evidence.length - 1; i >= 0; i--) if (out.has(evidence[i].id)) evidence.splice(i, 1);
        emit({ type: 'prune', ids: [...out] });
        dropped += out.size;
        if (process.env.RH_DEBUG) console.log('[namesakes]', [...research.vocabulary].slice(0, 24).join(' '), '→', namesakes.map((n) => n.title.slice(0, 50)));
      }
    }
  }

  // Too little to go on: say so, rather than let the AI write the case from memory.
  if (evidence.length + (primary ? 2 : 0) + (research?.reading.length ?? 0) < 3) {
    const what = venue ? `on ${venue.name} about “${framed}”` : framed ? `tying “${query}” to “${framed}”` : `about “${query}”`;
    const found = evidence.length;
    const premise = [...notes, found ? `Only ${found} source${found === 1 ? '' : 's'} turned up ${what}; it's pinned here.` : `Nothing turned up ${what}.`].join(' ');
    emit({
      type: 'analysis',
      analysis: {
        title: venue ? `${framed} on ${venue.name}` : query,
        summary: `${premise} ${found ? 'Read it for yourself, or try' : 'Try'} other words, check the spelling, or dig from a different card.`,
        hook: '',
        premise,
        entities: [],
        relations: [],
        timeline: [],
        tangents: (primary?.related ?? []).slice(0, 4).map((r) => ({ title: r, hook: 'Filed right next to this case. Worth a look.', query: r })),
        questions: [],
      },
    });
    emit({ type: 'done' });
    return;
  }
  if (dropped) emit({ type: 'status', message: `Filtered out ${dropped} off-topic result${dropped === 1 ? '' : 's'}` });

  // While the AI thinks, fetch preview images for text-only clues from their web pages.
  const thumbTask = (async () => {
    const targets = evidence.filter((it) => !it.image && !NO_PAGE_IMAGES.has(it.source) && (it.meta?.link || it.url)).slice(0, 12);
    const found: Record<string, string> = {};
    await Promise.allSettled(
      targets.map(async (it) => {
        const img = await ogImage(String(it.meta?.link ?? it.url), signal);
        if (img) found[it.id] = img;
      }),
    );
    if (Object.keys(found).length && !signal.aborted) emit({ type: 'thumbs', images: found });
  })();

  emit({ type: 'status', message: 'Connecting the dots…' });
  const dates = await Promise.race([keyDatesTask, sleep(4000).then(() => [] as KeyDate[])]);
  const providers = resolveProviders();
  const listed = (compact: boolean) => evidence.slice(0, compact ? 14 : 36);
  const attempt = (compact: boolean) =>
    completeWithFallback(
      providers,
      {
        messages: digMessages(venue ? `${framed} on ${venue.name}` : query, trail, primary, listed(compact), compact, framed, notes.length ? `The user typed “${asked}”. ${notes.join(' ')}` : undefined, venue?.name, [...castReading, ...(research?.reading ?? [])], research?.gallery, subject, dates),
        temperature: 0.6,
        maxTokens: compact ? 4000 : 8000,
        signal,
        timeoutMs: 100000,
      },
      (text) => {
        const analysis = normalizeAnalysis(parseJsonLoose(text), query);
        // A full case file with 1-2 cards means the reply was cut short: try the next brain.
        if (!compact && analysis.entities.length < 3) throw new Error(`only ${analysis.entities.length} entities (reply cut short?)`);
        return { analysis, compact };
      },
      (p, err) => {
        console.warn(`[ai] ${p.name} (${p.model}) failed during dig${compact ? ' (compact)' : ''}: ${err}`);
        emit({ type: 'status', message: 'Backup brain taking over…', level: 'warn' });
      },
    );
  try {
    const { value, provider } = await attempt(false).catch((e) => {
      if (signal.aborted) throw e;
      emit({ type: 'status', message: 'Condensing the case file…' });
      return attempt(true);
    });
    const { analysis, compact } = value;
    console.log(`[ai] dig "${query}" answered by ${provider.name} / ${provider.model}`);

    // The AI read every clue; toss the ones it flagged as off-topic (but never most of the board).
    const shown = listed(compact);
    const offtopic = (analysis.offtopic ?? []).map((n) => shown[n - 1]?.id).filter((id): id is string => !!id);
    const pruned = offtopic.length && offtopic.length <= Math.ceil(shown.length * 0.4) ? offtopic : [];
    if (pruned.length) emit({ type: 'prune', ids: pruned });
    delete analysis.offtopic;
    const BUDGET = 14;
    const keepNums = analysis.keep ?? [];
    delete analysis.keep;
    const tossed = new Set(pruned);
    const picked: string[] = [];
    const flagged = new Set(offtopic);
    const add = (id?: string) => id && !flagged.has(id) && !picked.includes(id) && picked.push(id);
    const byId = new Map(shown.map((x) => [x.id, x]));
    // Store and download pages, profiles and listings are background: only on the board if the AI cites them.
    const worthy = (id?: string) => !!id && !LOW_VALUE.test(byId.get(id)?.url ?? '');
    const ranked = rankRelevant(shown, { ...topicOf, phrasings: [phrase, titleHelps] });
    // 1. What the case file cites as evidence for its people and events.
    for (const c of analysis.citations ?? []) add(shown[c.evidence - 1]?.id);
    // 2. The wiki pages research chose (the feature, the list at the centre of it).
    for (const it of shown.filter((x) => x.source === 'fandom' && x.kind === 'article').slice(0, 3)) add(it.id);
    // 3. First-hand accounts: the top threads, and the top videos about it.
    for (const it of ranked.filter((x) => x.kind === 'post').slice(0, 2)) add(it.id);
    for (const it of ranked.filter((x) => x.kind === 'video' && worthy(x.id)).slice(0, 2)) add(it.id);
    // 4. Pages read in full: what the case was built from.
    const readUrls = new Set((research?.reading ?? []).map((r) => r.url));
    for (const it of shown.filter((x) => x.url && readUrls.has(x.url) && worthy(x.id) && namesSubject(subjectName(query), x.title)).slice(0, 4)) add(it.id);
    // 5. The AI's own picks, then the strongest matches if the board is still thin.
    for (const n of keepNums) if (worthy(shown[n - 1]?.id)) add(shown[n - 1]?.id);
    if (picked.length < 8) for (const it of ranked) if (worthy(it.id)) add(it.id);
    const board = new Set(picked.slice(0, BUDGET));
    if (process.env.RH_DEBUG) {
      const t = (id: string) => shown.find((x) => x.id === id)?.title.slice(0, 70) ?? id;
      console.log('[curate] shown', shown.length, 'of', evidence.length, compact ? '(compact)' : '');
      console.log('[curate] offtopic:', offtopic.map(t));
      console.log('[curate] board:', [...board].map(t));
    }
    const extras = evidence.filter((it) => !board.has(it.id) && !tossed.has(it.id)).map((it) => it.id);
    if (extras.length) emit({ type: 'extras', ids: extras });
    // Evidence numbers → the items they name, for strings between key sources and the cards they prove.
    const named = new Set(analysis.entities.map((e) => e.name.toLowerCase()));
    analysis.cites = (analysis.citations ?? [])
      .map((c) => ({ item: shown[c.evidence - 1]?.id, entity: c.entity, label: c.label }))
      .filter((c): c is { item: string; entity: string; label: string | undefined } => !!c.item && (named.has(c.entity.toLowerCase()) || c.entity === 'TOPIC'));
    delete analysis.citations;
    // Each moment points at the evidence it came from, so the timeline can open the proof.
    analysis.timeline = analysis.timeline.map(({ evidence, ...t }) => ({ ...t, item: evidence ? shown[evidence - 1]?.id : undefined }));
    // The "check this" note comes only from the app's own checks (a respelled name, a word no source has).
    // The AI's own doubts about a search ("no controversy is confirmed") contradicted its research; they go.
    analysis.premise = notes.length ? `${notes.join(' ')} This case follows “${query}”.` : undefined;
    // Every checked key date is on the timeline, even if the AI left it out.
    for (const kd of dates) {
      const y = kd.date.slice(0, kd.date.startsWith('-') ? 5 : 4);
      const head = kd.event.split(/[ (]/)[0].toLowerCase();
      const told = analysis.timeline.some((t) => t.date.startsWith(y) && (t.event.toLowerCase().includes(head) || kd.event.toLowerCase().split(' ').slice(1, 4).some((w) => w.length > 4 && t.event.toLowerCase().includes(w))));
      if (!told) analysis.timeline.push({ date: kd.date, event: kd.event.replace(/ ((.+))$/, ' in $1') });
    }
    analysis.timeline.sort((a, b) => parseInt(a.date, 10) - parseInt(b.date, 10) || a.date.localeCompare(b.date));

    // People, places and organisations must come from what the archives returned, not the AI's memory.
    const readInFull = [
      ...(research?.reading ?? []).map((r) => `${r.title} ${r.text}`),
      ...[...(research?.photos ?? []), ...(research?.gallery?.items ?? []), ...sideItems].map((p) => `${p.title} ${p.snippet ?? ''}`),
    ].join(' \n ');
    const ungrounded = groundEntities(analysis, primary, evidence, readInFull);
    if (ungrounded.length) {
      emit({ type: 'status', message: `Left off ${ungrounded.length} name${ungrounded.length === 1 ? '' : 's'} the sources never mention: ${ungrounded.slice(0, 4).join(', ')}`, level: 'warn' });
    }

    // Every case needs somewhere to fall next.
    if (analysis.tangents.length < 3) {
      emit({ type: 'status', message: 'Looking for the next rabbit holes…' });
      const extra = await completeWithFallback(
        providers,
        { messages: tangentMessages(query, analysis.summary, primary?.related ?? [], subject), temperature: 0.8, maxTokens: 1500, signal, timeoutMs: 60000 },
        (text) => {
          const t = normalizeTangents(parseJsonLoose(text));
          if (!t.length) throw new Error('no tangents');
          return t;
        },
      ).catch(() => null);
      const have = new Set(analysis.tangents.map((t) => t.title.toLowerCase()));
      // Wikipedia's "more like this" titles only when they are about the subject itself (not a neighbouring article).
      const fromWiki = (primary?.related ?? []).filter((r) => namesSubject(subject, r)).map((r) => ({ title: r, hook: 'Filed right next to this case. Worth a look.', query: r }));
      for (const t of [...(extra?.value ?? []), ...fromWiki]) {
        if (analysis.tangents.length >= 6) break;
        if (have.has(t.title.toLowerCase()) || t.title.toLowerCase() === query.toLowerCase()) continue;
        have.add(t.title.toLowerCase());
        analysis.tangents.push(t);
      }
    }
    const inCase = [subjectName(query), ...(framed ? [subjectName(framed)] : []), ...analysis.entities.map((e) => e.name)];
    const matchers = inCase.map((n) => nameMatcher(n, false));
    const squash = (s: string) => tokenize(s).join('');
    // Documents of this case: what it read, and the evidence titles. A name two of them discuss is part of the case.
    const docs = [
      ...(research?.reading ?? []).map((r) => new Set(tokenize(r.text))),
      ...evidence.map((e) => new Set(tokenize(`${e.title} ${e.snippet ?? ''}`))),
      new Set(tokenize(primary?.extract ?? '')),
    ];
    const PLAIN_WORDS = new Set('about after their there which would could should these those other first story stories history theory theories mystery secret secrets strange dark truth inside behind world games game music video videos legacy impact future story real rise fall power life death'.split(' '));
    const discussed = (text: string) =>
      [...new Set(tokenize(text))].some((w) => w.length >= 5 && !PLAIN_WORDS.has(w) && docs.filter((d) => d.has(w)).length >= 2);
    const grounded = (text: string) => {
      const toks = tokenize(text);
      const flat = squash(text);
      return matchers.some((m) => m(toks)) || inCase.some((n) => squash(n).length >= 6 && flat.includes(squash(n))) || discussed(text);
    };
    const before = analysis.tangents.length + analysis.questions.length;
    analysis.tangents = analysis.tangents.filter((t) => grounded(`${t.title} ${t.hook} ${t.query}`));
    // Falling into a rabbit hole searches with the subject in it, so it stays inside this case.
    for (const t of analysis.tangents) if (!namesSubject(subject, `${t.query} ${t.title}`)) t.query = `${subject} ${t.query}`.slice(0, 120);
    analysis.questions = analysis.questions.filter(grounded);
    const cut = before - analysis.tangents.length - analysis.questions.length;
    if (cut) console.log(`[dig] dropped ${cut} tangent/question idea(s) that don't touch the case`);
    emit({ type: 'analysis', analysis });

    emit({ type: 'status', message: 'Pinning photos and locations…' });
    const entities = await enrichEntities(analysis.entities, signal, subject);
    // Characters, invented places and things from the story: their pictures from its fan wiki.
    if (research?.wikiBase) {
      const want = analysis.entities.filter((e) => e.fictional || !entities[e.name]?.image).map((e) => e.name);
      const fromWiki = await Promise.race([wikiPictures(research.wikiBase, want, signal).catch(() => ({})), sleep(8000).then(() => ({}))]) as Awaited<ReturnType<typeof wikiPictures>>;
      for (const [name, w] of Object.entries(fromWiki)) {
        const e = analysis.entities.find((x) => x.name === name);
        if (!e || (!w.image && !e.fictional)) continue;
        entities[name] = { ...(e.fictional ? {} : entities[name]), image: w.image ?? entities[name]?.image, url: w.url };
      }
    }
    emit({ type: 'enrich', entities });
  } catch (e) {
    if (signal.aborted) return;
    console.error(`[ai] dig failed: ${errMsg(e)}`);
    emit({ type: 'error', message: 'The AI is overwhelmed right now. Your evidence is pinned; try digging again in a minute.' });
  }
  // Research that ran past the board's deadline still brings its lists (the wiki's keys, characters…).
  if (!research && !signal.aborted) {
    const late = await Promise.race([researchTask, sleep(40000).then(() => null)]);
    if (late && !signal.aborted) {
      if (late.gallery && (!framed || namesSubject(subject, `${late.gallery.title} ${late.gallery.about ?? ''} ${late.gallery.label ?? ''}`))) emit({ type: 'gallery', gallery: { ...late.gallery, source: 'fandom' } });
      for (const g of framed ? [] : (late.more ?? [])) emit({ type: 'gallery', gallery: { ...g, source: 'fandom' } });
    }
  }
  await Promise.allSettled([...tasks, photoTask, mediaTask, thumbTask, lookTask]);
  emit({ type: 'done' });
}
