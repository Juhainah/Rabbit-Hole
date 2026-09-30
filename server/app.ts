import 'dotenv/config';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { authProject, onGuestList, verifyVisitor, type Visitor } from './auth';
import type { ChatEvent, ChatRequest, DigEvent, DigRequest, SourceItem } from '../shared/types';
import { runDig } from './dig';
import { errMsg } from './http';
import { resolveProviders, streamWithFallback } from './llm';
import { chatMessages } from './prompts';
import { norm, rankRelevant, relevanceFilter, terms } from './relevance';
import { readAnything } from './reader';
import { youtubeId } from './scrape';
import { availableSources, searchSource } from './sources';
import { inspiration, wikiPrimary } from './sources/knowledge';
import { archiveMedia, periodIn, siteIn, waybackImages } from './sources/archives';
import { youtubeTranscript } from './sources/media';

// Words that say what to do, not what to look for.
const META_WORDS = new Set('yes yeah okay please connection connections connect link links linked relation related add pin note card cards board source sources photo photos picture pictures image images info information detail details anything something thing more show find bring tell explain give check work working api here there case clue clues about'.split(' '));

export const app = new Hono<{ Variables: { visitor?: Visitor } }>();

// Gentle per-IP limits so a public deployment can't burn through the free AI quotas.
const hits = new Map<string, number[]>();
function whoIs(c: Context) {
  const visitor = c.get('visitor') as Visitor | undefined;
  if (visitor) return `user:${visitor.uid}`;
  // Behind Vercel every request comes from its proxy; the real address is in a header it sets.
  if (process.env.VERCEL) return c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local'; /* not behind node-server (tests) */
  }
}

function limited(c: Context, bucket: string, max: number, windowMs: number) {
  const key = `${bucket}:${whoIs(c)}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

function ndjson<E extends { type: string }>(c: Context, run: (emit: (e: E) => void, signal: AbortSignal) => Promise<void>, onError: (m: string) => E) {
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-cache');
  c.header('X-Accel-Buffering', 'no');
  return stream(c, async (s) => {
    const ctrl = new AbortController();
    s.onAbort(() => ctrl.abort());
    const emit = (e: E) => {
      if (!ctrl.signal.aborted) void s.write(`${JSON.stringify(e)}\n`);
    };
    // Heartbeat: lets the browser tell a slow AI from a dead connection.
    const heartbeat = setInterval(() => emit({ type: 'ping' } as E), 10_000);
    try {
      await run(emit, ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) emit(onError(errMsg(e)));
    } finally {
      clearInterval(heartbeat);
    }
  });
}

app.get('/api/health', (c) => c.json({ ok: true, ai: resolveProviders().length > 0, signIn: !!authProject() }));

// When sign-in is on, every other API call must carry a valid Firebase ticket.
app.use('/api/*', async (c, next) => {
  if (!authProject() || c.req.path === '/api/health') return next();
  const visitor = await verifyVisitor(c.req.header('authorization'));
  if (!visitor) return c.json({ error: 'Please sign in to keep digging.', signIn: true }, 401);
  if (!onGuestList(visitor)) return c.json({ error: "This account isn't on the guest list for this Rabbit Hole.", signIn: true }, 403);
  c.set('visitor', visitor);
  await next();
});

app.get('/api/sources', (c) => c.json({ available: availableSources() }));

let inspo: { at: number; data: Awaited<ReturnType<typeof inspiration>> } | null = null;
app.get('/api/inspiration', async (c) => {
  if (!inspo || Date.now() - inspo.at > 10 * 60_000 || c.req.query('fresh')) inspo = { at: Date.now(), data: await inspiration() };
  return c.json(inspo.data);
});

app.get('/api/search', async (c) => {
  const source = c.req.query('source') ?? '';
  const q = (c.req.query('q') ?? '').trim();
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit') ?? 8)));
  if (!q) return c.json({ items: [] });
  if (!availableSources().includes(source)) return c.json({ error: 'Unknown source' }, 400);
  if (limited(c, 'search', 240, 10 * 60_000)) return c.json({ error: 'Slow down a little.' }, 429);
  try {
    return c.json({ items: await searchSource(source, q, { limit }) });
  } catch (e) {
    return c.json({ error: errMsg(e), items: [] }, 502);
  }
});

app.post('/api/dig', async (c) => {
  const body = await c.req.json<DigRequest>().catch(() => null);
  if (!body) return c.json({ error: 'Bad request' }, 400);
  if (limited(c, 'dig', 40, 10 * 60_000)) return c.json({ error: 'Too many digs. Take a breath and try again soon.' }, 429);
  return ndjson<DigEvent>(c, (emit, signal) => runDig(body, emit, signal), (message) => ({ type: 'error', message }));
});

app.post('/api/chat', async (c) => {
  const body = await c.req.json<ChatRequest>().catch(() => null);
  if (!body?.messages?.length) return c.json({ error: 'Bad request' }, 400);
  if (limited(c, 'chat', 80, 10 * 60_000)) return c.json({ error: 'Too many messages. Try again soon.' }, 429);
  return ndjson<ChatEvent>(
    c,
    async (emit, signal) => {
      const question = [...body.messages].reverse().find((m) => m.role === 'user')?.content.slice(0, 300) ?? '';
      // Sources carried over from the previous answer keep their numbers first.
      const carried = (body.carrySources ?? []).slice(0, 10);
      let sources: SourceItem[] = carried;
      if (body.research && question) {
        emit({ type: 'status', message: 'Checking the archives…' });
        const allowed = new Set(availableSources());
        // Questions and instructions search badly as-is; search the subject instead.
        const hint = body.hint?.trim().slice(0, 120);
        const wordy = question.split(/\s+/).length > 5 || /^(can|could|would|please|show|bring|pin|put|add|find|give|tell|list|check|what|whats|what's|why|how|who|when|where|which|is|are|was|were|did|do|does|has|have|any)\b/i.test(question);
        // New names the question brings in ("any connection to Epstein?") are searched together with the case.
        const caseWords = new Set(hint ? terms(hint) : []);
        const extra = terms(question).filter((w) => !caseWords.has(w) && !META_WORDS.has(w)).slice(0, 3);
        const phrase = wordy && hint ? [hint, ...extra].join(' ') : question;
        // Asking for pictures? Go to the photo archives.
        const wantsImages = /\b(photos?|pictures?|pics?|images?|photographs?|maps?|scans?|footage|drawings?|paintings?)\b/i.test(question);
        // Asking for recordings, films or the Internet Archive? Go to the Archive and fetch things that play.
        const wantsArchive = /\b(internet archive|archive\.org|archives?|archived)\b/i.test(question);
        const wantsAudio = /\b(audio|recordings?|recorded|broadcasts?|radio|podcasts?|interviews?|speech(es)?|sound|music|songs?|tapes?)\b/i.test(question);
        const wantsVideo = /\b(videos?|films?|footage|newsreels?|movies?|tv|television|clips?|documentar(y|ies))\b/i.test(question);
        const ids = [
          ...new Set([...(body.sources?.length ? body.sources : ['wikipedia', 'web', 'reddit']), 'commons', ...(wantsImages ? ['openverse', 'europeana', 'nasa'] : [])]),
        ]
          .filter((id) => allowed.has(id))
          .slice(0, wantsImages ? 9 : 7);
        // Research gets 12 seconds; slow sources are simply left out of this answer.
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
        // "A picture from rotten.com in March 2001": the Wayback Machine has what the site itself showed.
        const site = siteIn(question) ?? siteIn(hint ?? '');
        const archived = site && (periodIn(question) || /\b(archive[ds]?|wayback|snapshot|old|back then|used to|original)\b/i.test(question) || wantsImages);
        const mediaDeadline = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        const mediaTask = Promise.all([
          wantsAudio || wantsArchive ? archiveMedia(phrase, 'audio', 4, mediaDeadline).catch(() => []) : [],
          wantsVideo || wantsArchive ? archiveMedia(phrase, 'movies', 4, mediaDeadline).catch(() => []) : [],
          wantsArchive ? searchSource('archive', phrase, { limit: 4, signal: mediaDeadline }).catch(() => []) : [],
        ]).then((lists) => lists.flat());
        const waybackTask = archived ? waybackImages(site, periodIn(question), 8, AbortSignal.any([signal, AbortSignal.timeout(25_000)])).catch(() => []) : Promise.resolve([]);
        const [primary, ...batches] = await Promise.allSettled([
          wikiPrimary(phrase, deadline),
          ...ids.map((id) => searchSource(id, phrase, { limit: wantsImages && ['commons', 'openverse', 'europeana', 'nasa'].includes(id) ? 5 : 3, signal: deadline })),
        ]);
        // The main article must belong to the case: asking "did the data.gov key work?" on an
        // Apollo 11 board shouldn't cite a data scientist's biography.
        const caseTerms = hint ? terms(hint) : [];
        const fits = (a: { title: string; extract: string }) => !caseTerms.length || caseTerms.some((w) => norm(`${a.title} ${a.extract.slice(0, 1500)}`).includes(w));
        const p = primary.status === 'fulfilled' && primary.value && fits(primary.value) ? primary.value : null;
        const topic = { phrasings: [phrase, p?.title, hint], context: p?.extract };
        const isRelevant = relevanceFilter(topic);
        const found = rankRelevant(batches.flatMap((b) => (b.status === 'fulfilled' ? (b.value as SourceItem[]) : [])).filter(isRelevant), topic);
        if (p) found.unshift({ id: `wikipedia:${p.title}`, source: 'wikipedia', kind: 'article', title: p.title, snippet: p.extract.slice(0, 600), url: p.url, image: p.image });
        const seen = new Set<string>();
        // For picture requests, real photos come first so they get the low numbers.
        const fromArchive = await waybackTask;
        const media = await mediaTask;
        const playable = media.length ? rankRelevant(media.filter(relevanceFilter({ phrasings: [phrase, hint], context: p?.extract })), { phrasings: [phrase, hint] }) : [];
        // Archived pictures of the site asked about come first, so they get the low numbers.
        const ordered = [...fromArchive, ...playable, ...(wantsImages ? [...found.filter((s) => s.image), ...found.filter((s) => !s.image)] : found)];
        sources = [...carried, ...ordered].filter((s) => !seen.has(s.url ?? s.id) && seen.add(s.url ?? s.id)).slice(0, 20);
      }
      if (sources.length) emit({ type: 'sources', items: sources });
      const messages = chatMessages(body.messages, body.context, sources);
      for await (const piece of streamWithFallback(resolveProviders(), { messages, temperature: 0.7, maxTokens: 3000, signal }, (p, err) => {
        console.warn(`[ai] ${p.name} (${p.model}) failed during chat: ${err}`);
        emit({ type: 'status', message: 'Backup brain taking over…' });
      })) {
        if (piece.type === 'delta') emit({ type: 'delta', text: piece.text });
        else console.log(`[ai] chat answered by ${piece.provider.name} / ${piece.provider.model}`);
      }
      emit({ type: 'done' });
    },
    (m) => {
      console.error(`[ai] chat failed: ${m}`);
      return { type: 'error', message: 'Every AI brain is busy right now. Try again in a minute.' };
    },
  );
});

app.get('/api/scrape', async (c) => {
  const url = c.req.query('url') ?? '';
  if (limited(c, 'scrape', 120, 10 * 60_000)) return c.json({ error: 'Slow down a little.' }, 429);
  try {
    return c.json(await readAnything(url));
  } catch (e) {
    return c.json({ error: errMsg(e) }, 502);
  }
});

app.get('/api/transcript', async (c) => {
  const raw = c.req.query('id') ?? '';
  const id = youtubeId(raw) ?? (/^[\w-]{11}$/.test(raw) ? raw : null);
  if (!id) return c.json({ error: 'Not a YouTube video' }, 400);
  try {
    return c.json(await youtubeTranscript(id));
  } catch (e) {
    return c.json({ error: errMsg(e) }, 502);
  }
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));
