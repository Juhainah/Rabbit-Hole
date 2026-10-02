import { authEnabled, idToken, useAuth } from './auth';
import type { ChatEvent, ChatRequest, DigEvent, DigRequest, ScrapeResult, SourceItem } from '../../shared/types';

async function readError(res: Response) {
  const j = await res.json().catch(() => null);
  return (j as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
}

/** fetch, but "the server isn't running" gets a message people can act on. */
async function call(url: string, init?: RequestInit): Promise<Response> {
  try {
    // Signed-in visitors carry their ticket on every call.
    const token = await idToken().catch(() => undefined);
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && authEnabled) useAuth.setState({ status: 'signed-out', error: 'Your sign-in ran out. Please sign in again.' });
    // The dev proxy answers 502/504 without JSON when the API server is down.
    const ours = res.headers.get('content-type')?.includes('json') || res.headers.get('content-type')?.includes('ndjson');
    if ((res.status === 502 || res.status === 504) && !ours) throw new TypeError('proxy');
    return res;
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    if (e instanceof TypeError) throw new Error("Can't reach the Rabbit Hole server. Is `npm run dev` still running?");
    throw e;
  }
}

/** POSTs JSON and yields each NDJSON event as it streams in. */
async function streamNdjson<E extends { type: string }>(url: string, body: unknown, onEvent: (e: E) => void, signal?: AbortSignal) {
  // Our own controller, so a connection that goes silent can be cut.
  const ctrl = new AbortController();
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, 45_000);
  };
  let finished = false;
  const handle = (line: string) => {
    const e = JSON.parse(line) as E;
    if (e.type === 'done') finished = true;
    if (e.type !== 'ping') onEvent(e);
  };
  try {
    arm();
    const res = await call(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(await readError(res));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    }
    if (buf.trim()) handle(buf);
  } catch (e) {
    if (stalled) throw new Error('Lost the connection to the server (no reply for 45 seconds). Try again.');
    if (signal?.aborted) throw e;
    if (e instanceof TypeError) throw new Error('The connection to the server dropped. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!finished && !signal?.aborted) throw new Error('The server stopped before finishing (it may have restarted). Try again.');
}

export const api = {
  dig: (req: DigRequest, onEvent: (e: DigEvent) => void, signal?: AbortSignal) => streamNdjson('/api/dig', req, onEvent, signal),
  chat: (req: ChatRequest, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) =>
    streamNdjson('/api/chat', req, onEvent, signal),

  async search(source: string, q: string, limit = 8, signal?: AbortSignal): Promise<SourceItem[]> {
    const res = await call(`/api/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}&limit=${limit}`, { signal });
    if (!res.ok) throw new Error(await readError(res));
    return ((await res.json()) as { items: SourceItem[] }).items;
  },

  async scrape(url: string): Promise<ScrapeResult> {
    const res = await call(`/api/scrape?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  /** Every member of a wiki list (a who's-who card's source page), with pictures. */
  async wikiList(url: string, subject: string): Promise<{ title: string; url: string; items: { title: string; image?: string; url?: string }[] }> {
    const res = await call(`/api/wiki-list?url=${encodeURIComponent(url)}&subject=${encodeURIComponent(subject)}`);
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async transcript(id: string): Promise<{ title: string; text: string; lang: string }> {
    const res = await call(`/api/transcript?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async inspiration(fresh = false): Promise<{
    random: { title: string; snippet: string; image?: string }[];
    onThisDay: { year: number; text: string; title: string; image?: string }[];
  }> {
    const res = await call(`/api/inspiration${fresh ? '?fresh=1' : ''}`);
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async sources(): Promise<string[]> {
    const res = await call('/api/sources');
    if (!res.ok) return [];
    return ((await res.json()) as { available: string[] }).available;
  },

  /** A picture from another site, fetched by our server so it can go into a saved board picture. */
  async image(url: string): Promise<Blob> {
    const res = await call(`/api/image?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(await readError(res));
    return res.blob();
  },
};
