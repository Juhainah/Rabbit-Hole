import type { ScrapeResult } from '../shared/types';
import { enc, errMsg, getJson, getText, stripHtml } from './http';
import { assertPublicUrl, scrape } from './scrape';
import { decodeGoogleNews, isGoogleNews } from './gnews';

// Many sources wall their web pages (logins, bot checks) but publish the same
// content through open APIs. These readers use the APIs, so a clue opens as real
// content instead of "Human Verification".

type Reader = (url: URL) => Promise<ScrapeResult | null>;

const base = (url: URL, title: string): ScrapeResult => ({
  url: url.toString(),
  finalUrl: url.toString(),
  title,
  text: '',
  images: [],
  links: [],
  via: 'api',
});

/** Internet Archive items: catalog record, full OCR text when public, and a player for audio/video. */
const internetArchive: Reader = async (url) => {
  const id = url.pathname.match(/^\/(?:details|embed|stream)\/([^/?#]+)/)?.[1];
  if (!id) return null;
  const j = await getJson(`https://archive.org/metadata/${enc(id)}`, { timeout: 15000 });
  const m = j.metadata;
  if (!m) return null;
  const one = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v ? String(v) : undefined);
  const r = base(url, one(m.title) ?? id);
  r.byline = one(m.creator);
  r.published = one(m.date);
  r.siteName = 'Internet Archive';
  r.image = `https://archive.org/services/img/${id}`;
  const description = stripHtml(one(m.description) ?? '', 4000);
  const restricted = !!m['access-restricted-item'];
  if (m.mediatype === 'movies' || m.mediatype === 'audio' || m.mediatype === 'etree') r.media = { type: 'archive', src: id };

  let fullText = '';
  const txt = (j.files ?? []).find((f: { name: string }) => /_djvu\.txt$/.test(f.name))?.name;
  if (txt && !restricted) {
    // The storage node named in the metadata is the most reliable route; the public download URL is the backup.
    const direct = [j.server, j.d1, j.d2].filter(Boolean).map((h: string) => `https://${h}${j.dir}/${enc(txt)}`);
    for (const u of [...direct, `https://archive.org/download/${id}/${enc(txt)}`]) {
      fullText = await getText(u, { timeout: 25000 }).catch(() => '');
      if (fullText && !/^\s*<(!doctype|html)/i.test(fullText)) break;
      fullText = '';
    }
  }
  const subjects = one(m.subject);
  r.text = [description, subjects && `Subjects: ${subjects}`, fullText && `\n— FULL TEXT (scanned) —\n\n${fullText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 60000)}`]
    .filter(Boolean)
    .join('\n\n');
  if (restricted) r.note = 'This item is lend-only on the Internet Archive, so its full text is not public. Showing its catalog record.';
  r.alternatives = [{ label: 'Open on the Internet Archive', url: `https://archive.org/details/${id}` }];
  return r;
};

/** Open Library pages sit behind a login and bot check; their JSON API does not. */
const openLibrary: Reader = async (url) => {
  const key = url.pathname.match(/^\/(works|books)\/(OL\d+[WM])/)?.slice(1).join('/');
  if (!key) return null;
  const j = await getJson(`https://openlibrary.org/${key}.json`, { timeout: 15000 });
  const r = base(url, j.title ?? 'Book');
  r.siteName = 'Open Library';
  const desc = typeof j.description === 'string' ? j.description : j.description?.value;
  if (j.covers?.[0]) r.image = `https://covers.openlibrary.org/b/id/${j.covers[0]}-L.jpg`;
  r.published = j.first_publish_date;
  const scan = await getJson(`https://openlibrary.org/search.json?q=key:/${key}&fields=ia,ebook_access,public_scan_b,author_name`, { timeout: 12000 }).catch(() => null);
  const doc = scan?.docs?.[0];
  r.byline = doc?.author_name?.slice(0, 3).join(', ');
  r.text = [desc, (j.subjects ?? []).length ? `Subjects: ${j.subjects.slice(0, 15).join(', ')}` : ''].filter(Boolean).join('\n\n') || 'No description on file.';
  r.alternatives = [{ label: 'Search the Internet Archive for this title', url: `https://archive.org/search?query=${enc(r.title)}` }];
  const ia: string | undefined = doc?.ia?.[0];
  if (ia) {
    // A scanned copy exists: public ones come with their full text.
    const full = doc.public_scan_b ? await internetArchive(new URL(`https://archive.org/details/${ia}`)).catch(() => null) : null;
    if (full?.text) r.text = `${r.text}\n\n${full.text.slice(0, 60000)}`;
    r.alternatives.push({ label: doc.public_scan_b ? 'Read the full scan (free)' : 'Borrow the scan (free account)', url: `https://archive.org/details/${ia}` });
  }
  if (!ia) {
    // No scan on Open Library: many titles (government reports, old books) have a public copy on the Archive.
    const hit = await getJson(
      `https://archive.org/advancedsearch.php?q=${enc(`title:(${r.title}) AND mediatype:texts AND NOT collection:inlibrary`)}&fl[]=identifier&sort[]=downloads+desc&rows=1&output=json`,
      { timeout: 12000 },
    ).catch(() => null);
    const found: string | undefined = hit?.response?.docs?.[0]?.identifier;
    const copy = found ? await internetArchive(new URL(`https://archive.org/details/${found}`)).catch(() => null) : null;
    if (copy?.text) {
      r.text = `${r.text}

${copy.text.slice(0, 60000)}`;
      r.alternatives.push({ label: 'Public copy on the Internet Archive', url: `https://archive.org/details/${found}` });
      return r;
    }
  }
  r.note = doc?.public_scan_b ? undefined : 'Open Library asks for a free login to borrow this book, so the app shows its record instead.';
  return r;
};

/** Reddit blocks readers; the PullPush archive keeps the post and its comments. */
const reddit: Reader = async (url) => {
  const id = url.pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
  if (!id) return null;
  const [post, comments] = await Promise.all([
    getJson(`https://api.pullpush.io/reddit/search/submission/?ids=${id}`, { timeout: 15000 }),
    getJson(`https://api.pullpush.io/reddit/search/comment/?link_id=${id}&size=100`, { timeout: 15000 }).catch(() => ({ data: [] })),
  ]);
  const p = post.data?.[0];
  if (!p) return null;
  const r = base(url, p.title || 'Reddit thread');
  r.siteName = `r/${p.subreddit}`;
  r.byline = p.author ? `u/${p.author}` : undefined;
  r.published = p.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : undefined;
  r.text =
    p.selftext && !['[removed]', '[deleted]'].includes(p.selftext)
      ? p.selftext
      : p.url && !String(p.url).includes('reddit.com')
        ? `Link post: ${p.url}`
        : `_The post's own text was removed. Here is what people said underneath._`;
  r.format = 'markdown';
  r.comments = (comments.data ?? [])
    .filter((c: any) => c.body && c.body !== '[deleted]' && c.body !== '[removed]')
    .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 40)
    .map((c: any) => ({ author: c.author, text: c.body, score: c.score, depth: c.parent_id?.startsWith('t3_') ? 0 : 1 }));
  r.note = 'Read from the PullPush Reddit archive, so scores may be out of date.';
  return r;
};

/** Hacker News threads via the Algolia items API, comments included. */
const hackerNews: Reader = async (url) => {
  const id = url.searchParams.get('id');
  if (url.hostname !== 'news.ycombinator.com' || !id) return null;
  const j = await getJson(`https://hn.algolia.com/api/v1/items/${enc(id)}`, { timeout: 15000 });
  const r = base(url, j.title ?? 'Hacker News thread');
  r.siteName = 'Hacker News';
  r.byline = j.author;
  r.published = j.created_at?.slice(0, 10);
  r.text = stripHtml(j.text ?? '', 20000) || (j.url ? `Link: ${j.url}` : '');
  const flat: NonNullable<ScrapeResult['comments']> = [];
  const walk = (nodes: any[], depth: number) => {
    for (const c of nodes ?? []) {
      if (flat.length >= 60) return;
      if (c.text) flat.push({ author: c.author, text: stripHtml(c.text.replace(/<p>/g, '\n\n'), 3000), depth: Math.min(depth, 3) });
      if (depth < 3) walk(c.children, depth + 1);
    }
  };
  walk(j.children, 0);
  r.comments = flat;
  if (j.url) r.alternatives = [{ label: 'Read the linked article', url: j.url }];
  return r;
};

/** Wikipedia: the full article text from the API, not the page chrome. */
const wikipedia: Reader = async (url) => {
  const title = url.hostname.endsWith('wikipedia.org') ? decodeURIComponent(url.pathname.match(/^\/wiki\/(.+)$/)?.[1] ?? '') : '';
  if (!title || title.includes(':')) return null;
  const j = await getJson(
    `https://${url.hostname}/w/api.php?action=query&format=json&formatversion=2&titles=${enc(title)}&prop=extracts|pageimages&explaintext=1&exsectionformat=wiki&piprop=thumbnail&pithumbsize=960&redirects=1`,
    { timeout: 15000 },
  );
  const p = j.query?.pages?.[0];
  if (!p || p.missing) return null;
  const r = base(url, p.title);
  r.siteName = 'Wikipedia';
  r.image = p.thumbnail?.source;
  // "== Heading ==" becomes markdown headings.
  r.text = String(p.extract ?? '')
    .replace(/^(={2,})\s*(.+?)\s*\1$/gm, (_m: string, eq: string, h: string) => `${'#'.repeat(Math.min(4, eq.length))} ${h}`)
    .slice(0, 80000);
  r.format = 'markdown';
  return r;
};

const SPECIAL: [RegExp, Reader][] = [
  [/(^|\.)archive\.org$/, internetArchive],
  [/(^|\.)openlibrary\.org$/, openLibrary],
  [/(^|\.)reddit\.com$/, reddit],
  [/^news\.ycombinator\.com$/, hackerNews],
  [/(^|\.)wikipedia\.org$/, wikipedia],
];

const WALL = /human verification|just a moment|attention required|access denied|are you a robot|captcha|verify you are human|enable javascript|please (log|sign) in|sign in to continue|you('|’)re offline|checking your browser|request unsuccessful/i;

/** Looks like a bot check or login wall rather than the page itself. */
export function looksBlocked(r: ScrapeResult) {
  const head = `${r.title} ${r.text.slice(0, 1500)}`;
  return WALL.test(head) && r.text.length < 6000;
}

/** Read any link: site API first, then the page, then the Wayback Machine, then an honest "locked". */
/** Jina Reader returns any public page as clean text. A backup for sites that block servers. */
async function readViaJina(url: URL): Promise<ScrapeResult | null> {
  const res = await fetch(`https://r.jina.ai/${url.toString()}`, { headers: { Accept: 'application/json', 'X-Return-Format': 'markdown' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { data?: { title?: string; content?: string; url?: string } } | null;
  const text = (j?.data?.content ?? '').trim();
  // A login wall or bot check is not the page.
  if (text.length < 400 || WALL.test(text.slice(0, 600)) || /you've been blocked|verify you are human|log in to continue/i.test(text.slice(0, 800))) return null;
  return { ...base(url, j?.data?.title || url.hostname), text: text.slice(0, 150000), format: 'markdown', via: 'reader', siteName: url.hostname.replace(/^www\./, '') };
}

export async function readAnything(raw: string): Promise<ScrapeResult> {
  if (isGoogleNews(raw)) {
    const real = await decodeGoogleNews(raw);
    if (real) return readAnything(real);
  }
  const url = assertPublicUrl(raw);
  const host = url.hostname.replace(/^www\./, '');
  for (const [re, reader] of SPECIAL) {
    if (!re.test(host)) continue;
    const r = await reader(url).catch((e) => {
      console.warn(`[reader] ${host} API failed: ${errMsg(e)}`);
      return null;
    });
    if (r && (r.text || r.comments?.length || r.media)) return r;
  }

  let page: ScrapeResult | null = null;
  let failure = '';
  try {
    page = await scrape(url.toString());
  } catch (e) {
    failure = errMsg(e);
  }
  if (page && !looksBlocked(page) && page.text.trim().length > 200) return page;

  // Blocked or empty: a reading service fetches it from elsewhere (free, no key needed).
  const viaJina = await readViaJina(url).catch(() => null);
  if (viaJina) return viaJina;

  // Still nothing: the Wayback Machine often has a clean copy.
  const snap = await getJson(`https://archive.org/wayback/available?url=${enc(url.toString())}`, { timeout: 12000 }).catch(() => null);
  const s = snap?.archived_snapshots?.closest;
  if (s?.available) {
    const archived = await scrape(s.url).catch(() => null);
    if (archived && !looksBlocked(archived) && archived.text.trim().length > 200) {
      return { ...archived, url: url.toString(), via: 'wayback', archivedAt: s.timestamp };
    }
  }

  const title = page?.title && !WALL.test(page.title) ? page.title : host;
  return {
    ...base(url, title),
    siteName: host,
    blocked: true,
    note: failure
      ? `Couldn't open this page (${failure}).`
      : 'This site hides the page behind a login or a bot check, and there is no public archived copy.',
    alternatives: [
      { label: 'Search the Wayback Machine', url: `https://web.archive.org/web/*/${url.toString()}` },
      { label: 'Open it in your browser', url: url.toString() },
    ],
  };
}
