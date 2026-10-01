import type { Analysis, DigEvent, DigRequest, Primary, SourceItem } from '../shared/types';
import { errMsg, sleep } from './http';
import { parseJsonLoose } from './json';
import { completeWithFallback, resolveProviders } from './llm';
import { digMessages, normalizeAnalysis, normalizeTangents, tangentMessages } from './prompts';
import { namesSubject, norm, rankRelevant, relevanceFilter, subjectWords, terms } from './relevance';
import { ogImage, primaryFromUrl } from './scrape';
import { availableSources, searchSource } from './sources';
import { archiveMedia, siteIn, waybackImages } from './sources/archives';
import { nameMatcher, norm as nameKey, tokenize } from '../shared/names';
import { enrichEntities, wikiPrimary } from './sources/knowledge';

export type Emit = (ev: DigEvent) => void;

// Sources whose pages rarely carry a useful share image (or can't be fetched).
const NO_PAGE_IMAGES = new Set([
  'googlenews', 'reddit', 'openalex', 'arxiv', 'crossref', 'europepmc', 'semanticscholar', 'zenodo', 'oeis',
  'wikidata', 'wiktionary', 'urbandictionary', 'sec', 'fedregister', 'courtlistener', 'wayback', 'musicbrainz',
]);

/** Does the Wikipedia hit actually match the topic, or did search wander off? */
/** The main article has to be about the subject, not just share a word like "theory" with it. */
function primaryMatches(query: string, p: Primary) {
  return namesSubject(query, `${p.title} ${p.extract.slice(0, 1500)}`);
}

/** Long questions search badly. "why did the hikers die in 1959" searches better as "Dyatlov Pass incident". */
function searchPhrase(query: string, primary: Primary | null) {
  const long = query.split(/\s+/).length > 5 || /\?|^(why|how|what|who|when|where|was|did|is|are)\b/i.test(query);
  return long && primary ? primary.title : query;
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
const STORY_SOURCES = new Set(['web', 'reddit', 'forums', 'lemmy', 'hackernews', 'youtube', 'googlenews', 'gdelt', 'podcasts', 'dailymotion', 'archive', 'declassified', 'courtlistener', 'lostmedia', 'atlasobscura', 'fandom']);

const CHECKED_KINDS = new Set(['person', 'place', 'org']);

/**
 * Drops people, places and organisations that no source names. The AI is fluent
 * and sometimes wrong ("Talking Angela, by ZeptoLab, of Istanbul"); a card on the
 * board should be something the evidence actually mentions. Returns what was dropped.
 */
function groundEntities(analysis: Analysis, primary: Primary | null, evidence: SourceItem[]): string[] {
  const read = [primary?.title, primary?.extract, ...evidence.map((e) => `${e.title} ${e.snippet ?? ''} ${e.author ?? ''}`)].filter(Boolean).join(' \n ');
  const corpus = tokenize(read);
  if (corpus.length < 80) return []; // too little was read to judge
  const dropped = analysis.entities.filter((e) => CHECKED_KINDS.has(e.type) && !nameMatcher(e.name, e.type === 'person')(corpus));
  // Never strip a case bare.
  if (!dropped.length || analysis.entities.length - dropped.length < 3) return [];
  const gone = new Set(dropped.map((e) => nameKey(e.name)));
  analysis.entities = analysis.entities.filter((e) => !gone.has(nameKey(e.name)));
  analysis.relations = analysis.relations.filter((r) => !gone.has(nameKey(r.from)) && !gone.has(nameKey(r.to)));
  return dropped.map((e) => e.name);
}

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
  const query = topic || topicFromUrl(req.url!, primary?.title);

  if (!primary) {
    // The main article comes first (about a second) because it sharpens every other search.
    primary = await Promise.race([wikiPrimary(query, signal).catch(() => null), sleep(4500).then(() => null)]);
    if (primary && !primaryMatches(query, primary)) primary = null;
    // "Talking Angela conspiracy theories" can land on a broader article; look the name up on its own.
    const name = subjectWords(query).join(' ');
    if (name && name !== norm(query) && (!primary || !namesSubject(name, primary.title))) {
      const alt = await Promise.race([wikiPrimary(name, signal).catch(() => null), sleep(3500).then(() => null)]);
      if (alt && namesSubject(name, `${alt.title} ${alt.extract.slice(0, 1500)}`)) primary = alt;
    }
  }
  if (primary) emit({ type: 'primary', primary });

  const phrase = searchPhrase(query, primary);
  // A link's page title can be incidental ("Rotten.com Source Code/Mirror"); only a typed topic's article title helps judge results.
  // Dug from inside a case ("Jean Colombe" from rotten.com): results should tell the subject's part in that story.
  const caseQuery = req.caseQuery?.trim().slice(0, 120);
  // A narrower dig ("Voynich manuscript carbon dating") can land on the case's own article; that title would let
  // anything about the whole case through, so it only helps when it names something more specific.
  const caseWords = new Set(caseQuery ? terms(caseQuery) : []);
  const primaryIsCase = !!primary && caseWords.size > 0 && terms(primary.title).every((w) => caseWords.has(w));
  const titleHelps = topic && !primaryIsCase ? primary?.title : undefined;
  const framed = caseQuery && !norm(query).includes(norm(caseQuery)) && !norm(caseQuery).includes(norm(query)) ? caseQuery : undefined;
  const mentionsCase = framed ? relevanceFilter({ phrasings: [framed] }) : () => true;
  const topicOf = { phrasings: [query, titleHelps], context: [framed, primary?.extract].filter(Boolean).join('. ') };
  /** Searches that understand "subject + case" get both; reference works get the subject alone. */
  const phraseFor = (id: string) => (framed && STORY_SOURCES.has(id) ? `${phrase} ${framed}` : phrase);
  /** In a framed dig, results that tie back to the case come first; generic background gets one slot. */
  const framedPick = (items: SourceItem[], n: number, general = 1) =>
    framed ? [...items.filter(mentionsCase), ...items.filter((it) => !mentionsCase(it)).slice(0, general)].slice(0, n) : items.slice(0, n);
  const isRelevant = relevanceFilter(topicOf);
  const seen = new Set<string>();
  const keep = (items: SourceItem[]) =>
    items.filter((it) => {
      const key = it.url ?? it.id;
      if (seen.has(key) || !isRelevant(it)) return false;
      seen.add(key);
      return true;
    });

  const evidence: SourceItem[] = [];
  let dropped = 0;
  const tasks = sources.map(async (id) => {
    emit({ type: 'source-start', source: id });
    try {
      // Ask for extra, since the relevance filter may throw some away.
      const raw = await searchSource(id, phraseFor(id), { limit: per + 3, signal });
      // Best matches first, so the few slots per source go to the strongest evidence.
      const relevant = rankRelevant(keep(raw), { ...topicOf, phrasings: [phrase, titleHelps] });
      const items = framedPick(relevant, per);
      dropped += raw.length - relevant.length;
      evidence.push(...items);
      emit({ type: 'source', source: id, items });
    } catch (e) {
      if (!signal.aborted) emit({ type: 'source-error', source: id, error: errMsg(e) });
    }
  });

  // A dedicated photo pass, so every board gets real pictures, not just text.
  const photoTask = (async () => {
    const ids = ['commons', 'openverse'].filter((id) => allowed.has(id));
    // A website as the subject: its own pictures, as the Wayback Machine saved them.
    const site = siteIn(query);
    const batches = await Promise.allSettled([
      ...ids.map((id) => searchSource(id, phrase, { limit: id === 'commons' ? 8 : 5, signal })),
      ...(site ? [waybackImages(site, undefined, 6, signal)] : []),
    ]);
    const items = rankRelevant(keep(batches.flatMap((b) => (b.status === 'fulfilled' ? b.value : [])).filter((it) => it.image)), { ...topicOf, phrasings: [phrase, titleHelps] });
    const picked = framedPick(items, 8, 2);
    if (picked.length && !signal.aborted) emit({ type: 'photos', items: picked });
  })();

  // And a pass for things to listen to and watch: old broadcasts, oral histories, newsreels, podcasts.
  const mediaTask = (async () => {
    const batches = await Promise.allSettled([
      archiveMedia(phraseFor('archive'), 'audio', 5, signal),
      archiveMedia(phraseFor('archive'), 'movies', 5, signal),
      allowed.has('podcasts') ? searchSource('podcasts', phrase, { limit: 4, signal }) : Promise.resolve([]),
    ]);
    const [audio, films, pods] = batches.map((b) => (b.status === 'fulfilled' ? rankRelevant(keep(b.value), { ...topicOf, phrasings: [phrase, titleHelps] }) : []));
    const items = [...audio.slice(0, 2), ...films.slice(0, 2), ...pods.slice(0, 2)];
    if (items.length && !signal.aborted) emit({ type: 'media', items });
  })();

  // Slow sources keep streaming in, but the AI doesn't wait on them forever.
  await Promise.race([Promise.allSettled(tasks), sleep(18000)]);
  if (signal.aborted) return;
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
  const providers = resolveProviders();
  const listed = (compact: boolean) => evidence.slice(0, compact ? 14 : 36);
  const attempt = (compact: boolean) =>
    completeWithFallback(
      providers,
      {
        messages: digMessages(query, trail, primary, listed(compact), compact, framed),
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
    if (offtopic.length && offtopic.length <= Math.ceil(shown.length * 0.4)) emit({ type: 'prune', ids: offtopic });
    delete analysis.offtopic;

    // People, places and organisations must come from what the archives returned, not the AI's memory.
    const ungrounded = groundEntities(analysis, primary, evidence);
    if (ungrounded.length) {
      emit({ type: 'status', message: `Left off ${ungrounded.length} name${ungrounded.length === 1 ? '' : 's'} the sources never mention: ${ungrounded.slice(0, 4).join(', ')}`, level: 'warn' });
    }

    // Every case needs somewhere to fall next.
    if (analysis.tangents.length < 3) {
      emit({ type: 'status', message: 'Looking for the next rabbit holes…' });
      const extra = await completeWithFallback(
        providers,
        { messages: tangentMessages(query, analysis.summary, primary?.related ?? []), temperature: 0.8, maxTokens: 1500, signal, timeoutMs: 60000 },
        (text) => {
          const t = normalizeTangents(parseJsonLoose(text));
          if (!t.length) throw new Error('no tangents');
          return t;
        },
      ).catch(() => null);
      const have = new Set(analysis.tangents.map((t) => t.title.toLowerCase()));
      const fromWiki = (primary?.related ?? []).map((r) => ({ title: r, hook: 'Filed right next to this case. Worth a look.', query: r }));
      for (const t of [...(extra?.value ?? []), ...fromWiki]) {
        if (analysis.tangents.length >= 6) break;
        if (have.has(t.title.toLowerCase()) || t.title.toLowerCase() === query.toLowerCase()) continue;
        have.add(t.title.toLowerCase());
        analysis.tangents.push(t);
      }
    }
    emit({ type: 'analysis', analysis });

    emit({ type: 'status', message: 'Pinning photos and locations…' });
    const entities = await enrichEntities(analysis.entities, signal);
    emit({ type: 'enrich', entities });
  } catch (e) {
    if (signal.aborted) return;
    console.error(`[ai] dig failed: ${errMsg(e)}`);
    emit({ type: 'error', message: 'The AI is overwhelmed right now. Your evidence is pinned; try digging again in a minute.' });
  }
  await Promise.allSettled([...tasks, photoTask, mediaTask, thumbTask]);
  emit({ type: 'done' });
}
