import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Primary, ScrapeResult } from '../shared/types';
import { BROWSER_UA, enc, errMsg, getJson, getText, http } from './http';
import { youtubeTranscript } from './sources/media';

const quiet = () => new VirtualConsole();

/** Refuse obviously internal addresses so the scraper can't be pointed at the host's own network. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL.');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links can be read.');
  const h = u.hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '[::1]' ||
    h.startsWith('[fc') ||
    h.startsWith('[fd')
  ) {
    throw new Error('Private network addresses cannot be read.');
  }
  return u;
}

export const youtubeId = (url: string) =>
  url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)?.[1];

const HTML_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string; via: ScrapeResult['via']; archivedAt?: string }> {
  try {
    const res = await http(url, { headers: HTML_HEADERS, timeout: 20000 });
    return { html: await res.text(), finalUrl: res.url || url, via: 'direct' };
  } catch (e) {
    // Dead or blocked? Ask the Wayback Machine for its closest snapshot.
    const snap = await getJson(`https://archive.org/wayback/available?url=${enc(url)}`, { timeout: 12000 }).catch(() => null);
    const s = snap?.archived_snapshots?.closest;
    if (!s?.available) throw new Error(`Could not read the page (${errMsg(e)}) and it is not in the Wayback Machine.`);
    const html = await getText(s.url, { headers: HTML_HEADERS, timeout: 25000 });
    return { html, finalUrl: s.url, via: 'wayback', archivedAt: s.timestamp };
  }
}

export async function scrape(raw: string): Promise<ScrapeResult> {
  const url = assertPublicUrl(raw).toString();
  const { html, finalUrl, via, archivedAt } = await fetchHtml(url);
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole: quiet() });
  const doc = dom.window.document;
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined;
  const abs = (src?: string | null) => {
    try {
      return src ? new URL(src, finalUrl).toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const image = abs(meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]'));
  const published =
    meta('meta[property="article:published_time"]') ?? doc.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
  const images = [
    ...new Set(
      [...doc.querySelectorAll('img')]
        .map((img) => abs(img.getAttribute('src') ?? img.getAttribute('data-src')))
        .filter((s): s is string => !!s && /^https?:/.test(s) && !/sprite|icon|logo|pixel|avatar|badge|\.svg|data:/i.test(s)),
    ),
  ].slice(0, 12);
  const seenLinks = new Set<string>();
  const links = [...doc.querySelectorAll('a[href]')]
    .map((a) => ({ href: abs(a.getAttribute('href')) ?? '', text: (a.textContent ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => {
      if (!/^https?:/.test(l.href) || l.text.length < 4 || l.text.length > 120 || seenLinks.has(l.href)) return false;
      seenLinks.add(l.href);
      return true;
    })
    .slice(0, 60);

  const article = new Readability(doc).parse();
  let text = (article?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  let finalVia = via;
  if (text.length < 400 && via === 'direct') {
    // Probably rendered by JavaScript. Jina's free reader renders it for us.
    const md = await getText(`https://r.jina.ai/${url}`, { timeout: 25000, headers: { Accept: 'text/plain' } }).catch(() => '');
    if (md.length > text.length) {
      text = md.replace(/^Title:.*\n|^URL Source:.*\n|^Markdown Content:\n/gm, '').trim();
      finalVia = 'reader';
    }
  }

  return {
    url,
    finalUrl,
    title: article?.title || doc.title || url,
    byline: article?.byline ?? undefined,
    siteName: article?.siteName ?? meta('meta[property="og:site_name"]'),
    excerpt: article?.excerpt ?? meta('meta[name="description"]'),
    text: text.slice(0, 40000),
    image,
    images,
    links,
    published,
    via: finalVia,
    archivedAt,
    format: finalVia === 'reader' ? 'markdown' : 'text',
  };
}

/** A page's share image (og:image / twitter:image), so text clues get a picture. */
export async function ogImage(raw: string, signal?: AbortSignal): Promise<string | undefined> {
  const url = assertPublicUrl(raw).toString();
  const res = await http(url, { headers: HTML_HEADERS, timeout: 7000, signal });
  const html = (await res.text()).slice(0, 300_000);
  const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/i)?.[0];
  const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
  if (!content) return undefined;
  const img = new URL(content.replace(/&amp;/g, '&'), res.url || url).toString();
  return /^https?:/.test(img) && !/logo|favicon|sprite|placeholder|default-share/i.test(img) ? img : undefined;
}

/** The "main article" for a dig that starts from a link instead of a topic. */
export async function primaryFromUrl(url: string): Promise<Primary> {
  const yt = youtubeId(url);
  if (yt) {
    const t = await youtubeTranscript(yt);
    return {
      title: t.title,
      extract: `VIDEO TRANSCRIPT:\n${t.text.slice(0, 7000)}`,
      url: `https://www.youtube.com/watch?v=${yt}`,
      image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      source: 'youtube',
    };
  }
  const { readAnything } = await import('./reader');
  const page = await readAnything(url);
  if (page.blocked) throw new Error(page.note ?? 'That page is locked.');
  return {
    title: page.title,
    extract: [page.text, ...(page.comments ?? []).slice(0, 25).map((c) => `Comment: ${c.text}`)].join('\n').slice(0, 7000),
    url: page.finalUrl,
    image: page.image,
    source: 'web',
  };
}
