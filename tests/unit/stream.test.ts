import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamWithFallback, type StreamPiece } from '../../server/llm';

// A partner answer must never freeze half-written: a brain that goes quiet mid-answer, or stops
// after a few words, hands over to the next one, and the half answer is wiped.

const sse = (chunks: string[], hang = false) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const t of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
        if (!hang) {
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        }
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const provider = (id: string) => ({ id, name: id, baseUrl: `https://${id}.test`, chatPath: '/chat', apiKey: 'k', model: `${id}-model` });

afterEach(() => vi.unstubAllGlobals());

async function collect(gen: AsyncGenerator<StreamPiece>) {
  let text = '';
  const kinds: string[] = [];
  for await (const p of gen) {
    kinds.push(p.type);
    if (p.type === 'delta') text += p.text;
    if (p.type === 'reset') text = '';
  }
  return { text, kinds };
}

describe('streaming answers', () => {
  it('hands over when a brain goes quiet mid-answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('first') ? sse(['The search results confirm'], true) : sse(['A full answer.\nTANGENTS: a | b | c']))));
    const out = await collect(streamWithFallback([provider('first'), provider('second')] as never, { messages: [{ role: 'user', content: 'q' }], expectEnd: /TANGENTS\s*:/i }));
    expect(out.kinds).toContain('reset');
    expect(out.text).toBe('A full answer.\nTANGENTS: a | b | c');
  }, 30_000);

  it('hands over when a brain stops after a few words', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('first') ? sse(['The search']) : sse(['Done properly. TANGENTS: x | y | z']))));
    const out = await collect(streamWithFallback([provider('first'), provider('second')] as never, { messages: [{ role: 'user', content: 'q' }], expectEnd: /TANGENTS\s*:/i }));
    expect(out.text).toBe('Done properly. TANGENTS: x | y | z');
  });

  it('keeps a complete answer as it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse(['Hello ', 'there. TANGENTS: a | b | c'])));
    const out = await collect(streamWithFallback([provider('only')] as never, { messages: [{ role: 'user', content: 'q' }], expectEnd: /TANGENTS\s*:/i }));
    expect(out.kinds).not.toContain('reset');
    expect(out.text).toBe('Hello there. TANGENTS: a | b | c');
  });
});
