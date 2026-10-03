import 'dotenv/config';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { authProject, onGuestList, verifyVisitor, type Visitor } from './auth';
import type { ChatEvent, ChatRequest, DigEvent, DigRequest, SourceItem } from '../shared/types';
import { chatResearch } from './chat-research';
import { galleryFromUrl } from './research';
import { imageProxy } from './imageproxy';
import { castOf } from './sources/cast';
import { suggestLinks, type WeaveCard } from './weave';
import { runDig } from './dig';
import { errMsg } from './http';
import { resolveProviders, streamWithFallback } from './llm';
import { chatMessages } from './prompts';
import { readAnything } from './reader';
import { youtubeId } from './scrape';
import { availableSources, searchSource } from './sources';
import { inspiration } from './sources/knowledge';
import { youtubeTranscript } from './sources/media';
import { logServerError, overDailyLimit } from './limits';

/** The visitor's sign-in ticket, passed on so Supabase counts and logs as them. */
const ticket = (c: Context) => c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];

/** Questions about the board itself ("strangest detail on this board?") are answered from the board, not the archives. */
const ABOUT_THE_BOARD = /\b(clean|tidy|declutter|remove|delete|get rid of|unpin)\b|\b(this|the|my|our)\s+(board|investigation|cards?|clues?|evidence)\b|\bthese\s+(cards?|clues?|cases?|photos?|sources?|people)\b|\bon (the|this|my) board\b|\b(contradict\w*|skeptic\w*|summari[sz]e|recap|so far)\b/i;

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
      if (!ctrl.signal.aborted) {
        emit(onError(errMsg(e)));
        logServerError(ticket(c), c.req.path, e);
      }
    } finally {
      clearInterval(heartbeat);
    }
  });
}

app.get('/api/health', async (c) => {
  const base = { ok: true, ai: resolveProviders().length > 0, signIn: !!authProject(), node: process.version };
  if (!c.req.query('probe')) return c.json(base);
  // Which outside services this server can reach (status codes only, nothing user-specific).
  const probe = async (url: string) => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'RabbitHole health check' }, signal: AbortSignal.timeout(12000) });
      return `${r.status} in ${Date.now() - t0}ms`;
    } catch (e) {
      return `failed: ${errMsg(e)}`;
    }
  };
  const [pullpush, reddit, wiki, gnews] = await Promise.all([
    probe('https://api.pullpush.io/reddit/search/submission/?ids=1azw9tr'),
    probe('https://www.reddit.com/r/MobileGaming/comments/1azw9tr/.json'),
    probe('https://en.wikipedia.org/api/rest_v1/page/summary/Rabbit_hole'),
    probe('https://news.google.com/rss/search?q=test'),
  ]);
  return c.json({ ...base, reach: { pullpush, reddit, wiki, gnews } });
});

// When sign-in is on, every other API call must carry a valid Firebase ticket.
app.use('/api/*', async (c, next) => {
  if (!authProject() || c.req.path === '/api/health') return next();
  const visitor = await verifyVisitor(c.req.header('authorization'));
  if (!visitor) return c.json({ error: 'Please sign in to keep digging.', signIn: true }, 401);
  if (!onGuestList(visitor)) return c.json({ error: "This account isn't on the guest list for this Rabbit Hole.", signIn: true }, 403);
  c.set('visitor', visitor);
  // Digs and partner messages count toward a daily allowance per account.
  const bucket = c.req.method !== 'POST' ? null : c.req.path === '/api/dig' ? 'dig' : c.req.path === '/api/chat' ? 'chat' : null;
  const over = bucket && (await overDailyLimit(ticket(c), bucket));
  if (over) return c.json({ error: over, limit: true }, 429);
  await next();
});

// Anything that slips through still answers in plain words, and lands in the owner's error log.
app.onError((e, c) => {
  logServerError(ticket(c), `${c.req.method} ${c.req.path}`, e);
  console.error(e);
  return c.json({ error: 'Something went wrong on our side. Try again in a moment.' }, 500);
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
      const aboutBoard = ABOUT_THE_BOARD.test(question) && !/\b(find|search|fetch|bring|pin|get|look up|add|locate|show me|pictures?|photos?)\b/i.test(question);
      if ((body.research || body.searchFor?.length) && question && (!aboutBoard || body.searchFor?.length)) {
        emit({ type: 'status', message: 'Checking the archives…' });
        const found = await chatResearch(question, body.hint?.trim().slice(0, 120), body.sources, signal, body.focus, {
          searchFor: body.searchFor?.map((q) => String(q).slice(0, 120)),
          onStatus: (message) => emit({ type: 'status', message }),
          // The last few turns, so a follow-up ("where is that article?") searches for the right thing.
          earlier: body.messages
            .slice(-5, -1)
            .map((m) => `${m.role === 'user' ? 'User' : 'Partner'}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`)
            .join('\n'),
          lastAsked: [...body.messages].reverse().filter((m) => m.role === 'user')[1]?.content.slice(0, 200),
        });
        const seen = new Set<string>();
        sources = [...carried, ...found].filter((s) => !seen.has(s.image ?? s.url ?? s.id) && seen.add(s.image ?? s.url ?? s.id)).slice(0, 20);
      }
      if (sources.length) emit({ type: 'sources', items: sources });
      const messages = chatMessages(body.messages, body.context, sources);
      for await (const piece of streamWithFallback(resolveProviders(), { messages, temperature: 0.7, maxTokens: 3000, signal, expectEnd: /TANGENTS\s*:/i }, (p, err) => {
        console.warn(`[ai] ${p.name} (${p.model}) failed during chat: ${err}`);
        emit({ type: 'status', message: 'Backup brain taking over…' });
      })) {
        if (piece.type === 'delta') emit({ type: 'delta', text: piece.text });
        else if (piece.type === 'reset') emit({ type: 'reset' });
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

// "Weave this": strings the AI suggests between cards already on a board.
app.post('/api/weave', async (c) => {
  const body = await c.req.json<{ cards?: WeaveCard[]; tied?: [string, string][] }>().catch(() => null);
  if (!body?.cards?.length) return c.json({ error: 'Bad request' }, 400);
  if (limited(c, 'chat', 80, 10 * 60_000)) return c.json({ error: 'Too many requests. Try again soon.' }, 429);
  try {
    const links = await suggestLinks(body.cards, body.tied ?? [], AbortSignal.timeout(90_000));
    return c.json({ links });
  } catch (e) {
    return c.json({ error: 'Every AI brain is busy right now. Try again in a minute.', detail: errMsg(e) }, 502);
  }
});

app.get('/api/cast', async (c) => {
  if (limited(c, 'scrape', 120, 10 * 60_000)) return c.json({ error: 'Slow down a little.' }, 429);
  try {
    const cast = await castOf(c.req.query('title') ?? '', AbortSignal.timeout(20_000));
    return cast ? c.json({ title: cast.title, url: cast.url, director: cast.director, items: cast.items.map((p) => ({ title: p.title, image: p.image, url: p.url, role: p.meta?.role })) }) : c.json({ error: 'No cast list on that page' }, 404);
  } catch (e) {
    return c.json({ error: errMsg(e) }, 502);
  }
});

app.get('/api/wiki-list', async (c) => {
  if (limited(c, 'scrape', 120, 10 * 60_000)) return c.json({ error: 'Slow down a little.' }, 429);
  try {
    const g = await galleryFromUrl(c.req.query('url') ?? '', c.req.query('subject') ?? '', AbortSignal.timeout(25_000));
    return g ? c.json({ title: g.title, url: g.url, items: g.items.map((p) => ({ title: p.title, image: p.image, url: p.url })) }) : c.json({ error: 'No pictured list on that page' }, 404);
  } catch (e) {
    return c.json({ error: errMsg(e) }, 502);
  }
});

// Card photos for a saved board picture, fetched here so the browser may draw them.
app.get('/api/image', async (c) => {
  if (limited(c, 'image', 400, 10 * 60_000)) return c.json({ error: 'Slow down a little.' }, 429);
  return imageProxy(c);
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
