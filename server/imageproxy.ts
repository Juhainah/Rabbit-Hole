import type { Context } from 'hono';
import { BROWSER_UA, errMsg, UA } from './http';
import { assertPublicUrl } from './scrape';

// Card photos come from many sites, and most won't let a web page copy their pixels.
// Saving a board as a picture needs those pixels, so the server fetches the image and
// hands it back from our own address. Public addresses and ordinary image types only.

const TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)\b/i;
const MAX_BYTES = 6_000_000;

export async function imageProxy(c: Context) {
  let url: URL;
  try {
    url = assertPublicUrl(c.req.query('url') ?? '');
  } catch (e) {
    return c.json({ error: errMsg(e) }, 400);
  }
  try {
    // Follow redirects by hand, so one can't lead to a private address.
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      // Wikimedia asks callers to say who they are; other sites expect a browser.
      const agent = /(^|\.)(wikimedia|wikipedia)\.org$/.test(url.hostname) ? UA : BROWSER_UA;
      res = await fetch(url, { headers: { 'User-Agent': agent, Accept: 'image/*' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      url = assertPublicUrl(new URL(next, url).toString());
      res = null;
    }
    if (!res) return c.json({ error: 'Too many redirects.' }, 502);
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) return c.json({ error: `The picture's site answered ${res.status}.` }, 502);
    if (!TYPES.test(type)) return c.json({ error: 'That address is not a picture.' }, 415);
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return c.json({ error: 'That picture is too big.' }, 413);
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return c.json({ error: 'That picture is too big.' }, 413);
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
      },
    });
  } catch (e) {
    return c.json({ error: `Couldn't fetch that picture (${errMsg(e)}).` }, 502);
  }
}
