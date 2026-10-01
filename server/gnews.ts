import { BROWSER_UA } from './http';

// Google News links (news.google.com/rss/articles/…) are redirects that only open in
// a browser. Google's own page hands out a signature that turns one into the real
// article address, so cards and the Reader can go straight to the source.

const cache = new Map<string, string | null>();

export const isGoogleNews = (url: string) => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//.test(url);

export async function decodeGoogleNews(url: string, signal?: AbortSignal): Promise<string | null> {
  const id = url.match(/articles\/([^?/#]+)/)?.[1];
  if (!id) return null;
  if (cache.has(id)) return cache.get(id)!;
  try {
    const opts = { headers: { 'User-Agent': BROWSER_UA }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) };
    const page = await (await fetch(`https://news.google.com/articles/${id}`, opts)).text();
    const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sg || !ts) throw new Error('no signature');
    const req = [[['Fbv4je', `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`, null, 'generic']]];
    const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      ...opts,
      method: 'POST',
      headers: { ...opts.headers, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `f.req=${encodeURIComponent(JSON.stringify(req))}`,
    });
    const text = await res.text();
    const real = (text.match(/\\"garturlres\\",\\"(.*?)\\"/)?.[1] ?? text.match(/"garturlres","([^"]+)"/)?.[1])?.replace(/\\\\u003d/g, '=').replace(/\\u003d/g, '=');
    const out = real && /^https?:\/\//.test(real) ? real : null;
    cache.set(id, out);
    return out;
  } catch {
    cache.set(id, null);
    return null;
  }
}
