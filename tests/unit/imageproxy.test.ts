import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageProxy } from '../../server/imageproxy';

// The image fetcher must only ever hand back ordinary pictures from public addresses.
const app = new Hono().get('/img', imageProxy);
const ask = (url: string) => app.request(`/img?url=${encodeURIComponent(url)}`);
const reply = (body: BodyInit | null, init: ResponseInit) => vi.fn(async () => new Response(body, init));

afterEach(() => vi.unstubAllGlobals());

describe('image fetcher', () => {
  it('refuses private and non-web addresses without fetching anything', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const url of ['http://127.0.0.1/a.png', 'http://localhost/a.png', 'http://192.168.1.10/a.png', 'http://10.0.0.5/a.png', 'file:///etc/passwd', 'not a url']) {
      expect((await ask(url)).status, url).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a picture through with locked-down headers', async () => {
    vi.stubGlobal('fetch', reply(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } }));
    const res = await ask('https://example.com/photo.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
  });

  it('refuses pages and SVGs (an SVG can carry script)', async () => {
    vi.stubGlobal('fetch', reply('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect((await ask('https://example.com/page')).status).toBe(415);
    vi.stubGlobal('fetch', reply('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }));
    expect((await ask('https://example.com/x.svg')).status).toBe(415);
  });

  it('refuses a redirect that leads to a private address', async () => {
    vi.stubGlobal('fetch', reply(null, { status: 302, headers: { location: 'http://127.0.0.1/admin.png' } }));
    const res = await ask('https://example.com/sneaky.png');
    expect(res.status).not.toBe(200);
  });

  it('refuses very large pictures', async () => {
    vi.stubGlobal('fetch', reply('x', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '9000000' } }));
    expect((await ask('https://example.com/huge.jpg')).status).toBe(413);
  });

  it("says so when the picture's site refuses", async () => {
    vi.stubGlobal('fetch', reply('nope', { status: 403, headers: { 'content-type': 'text/html' } }));
    const res = await ask('https://example.com/blocked.jpg');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/403/);
  });
});
