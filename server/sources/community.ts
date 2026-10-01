import type { SourceItem } from '../../shared/types';
import { enc, errMsg, getJson, stripHtml } from '../http';
import { webSearch } from './web';
import { host, type SearchFn } from './types';

// Reddit blocks most anonymous JSON traffic now. We try the official API (with
// optional free app credentials), then fall back to the PullPush archive.
let redditBlockedUntil = 0;
let redditToken: { value: string; exp: number } | null = null;

async function redditAuth(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken && redditToken.exp > Date.now()) return redditToken.value;
  const j = await getJson('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  redditToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return redditToken.value;
}

function redditItem(d: any): SourceItem {
  const thumb = typeof d.thumbnail === 'string' && d.thumbnail.startsWith('http') ? d.thumbnail : undefined;
  const preview = d.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&');
  return {
    id: `reddit:${d.id}`,
    source: 'reddit',
    kind: 'post',
    title: stripHtml(d.title, 300),
    snippet: stripHtml(d.selftext, 360) || (d.url && !String(d.url).includes('reddit.com') ? host(d.url) : ''),
    url: `https://www.reddit.com${d.permalink}`,
    image: preview ?? thumb,
    date: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 10) : undefined,
    author: d.author ? `u/${d.author}` : undefined,
    meta: { sub: `r/${d.subreddit}`, score: d.score ?? 0, comments: d.num_comments ?? 0 },
  };
}

export const reddit: SearchFn = async (q, { limit, signal }) => {
  if (Date.now() > redditBlockedUntil) {
    try {
      const token = await redditAuth();
      const url = token
        ? `https://oauth.reddit.com/search?q=${enc(q)}&limit=${limit}&sort=relevance&raw_json=1`
        : `https://www.reddit.com/search.json?q=${enc(q)}&limit=${limit}&sort=relevance&raw_json=1`;
      const j = await getJson(url, {
        signal,
        timeout: 8000,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const posts = (j.data?.children ?? []).map((c: any) => c.data).filter((d: any) => !d.over_18);
      if (posts.length) return posts.slice(0, limit).map(redditItem);
    } catch (e) {
      if (signal?.aborted) throw e;
      redditBlockedUntil = Date.now() + 10 * 60_000;
      console.warn(`[reddit] official API unavailable (${errMsg(e)}), using PullPush`);
    }
  }
  // The archive, matching post titles (its full-text search returns anything that mentions a word once).
  const archived = await getJson(`https://api.pullpush.io/reddit/search/submission/?title=${enc(q)}&size=${Math.min(100, limit * 4)}`, { signal, timeout: 9000 })
    .then((j) =>
      (j.data ?? []).filter((d: any) => !d.over_18 && d.title && d.selftext !== '[removed]' && d.selftext !== '[deleted]'),
    )
    .catch((e) => {
      if (signal?.aborted) throw e;
      return [] as any[];
    });
  archived.sort((a: any, b: any) => (b.score ?? 0) + (b.num_comments ?? 0) - ((a.score ?? 0) + (a.num_comments ?? 0)));
  const items: SourceItem[] = archived.slice(0, limit).map(redditItem);
  if (items.length >= Math.min(2, limit)) return items;
  // Too little: the threads a search engine ranks best for this topic.
  const found = await webSearch(`${q} site:reddit.com`, limit + 3, signal).catch(() => []);
  const seen = new Set(items.map((i) => i.url));
  for (const it of found) {
    const m = it.url?.match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    if (!m || seen.has(it.url)) continue;
    seen.add(it.url);
    items.push({
      ...it,
      id: `reddit:${m[2]}`,
      source: 'reddit',
      kind: 'post',
      title: it.title.replace(/\s*:\s*r\/\w+\s*$/i, '').replace(/\s*[-|]\s*Reddit\s*$/i, '').trim(),
      meta: { sub: `r/${m[1]}` },
    });
  }
  return items.slice(0, limit);
};

export const hackernews: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://hn.algolia.com/api/v1/search?query=${enc(q)}&tags=story&hitsPerPage=${limit}`, {
    signal,
  });
  return (j.hits ?? []).map((h: any) => ({
    id: `hackernews:${h.objectID}`,
    source: 'hackernews',
    kind: 'post' as const,
    title: h.title ?? h.story_title ?? 'Untitled',
    snippet: stripHtml(h.story_text, 300) || (h.url ? host(h.url) : ''),
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    date: h.created_at?.slice(0, 10),
    author: h.author,
    meta: { sub: 'Hacker News', score: h.points ?? 0, comments: h.num_comments ?? 0, ...(h.url ? { link: h.url } : {}) },
  }));
};

export const lemmy: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://lemmy.world/api/v3/search?q=${enc(q)}&type_=Posts&limit=${limit}&sort=TopAll`, {
    signal,
  });
  return (j.posts ?? []).map((p: any) => ({
    id: `lemmy:${p.post.id}`,
    source: 'lemmy',
    kind: 'post' as const,
    title: p.post.name,
    snippet: stripHtml(p.post.body, 300),
    url: p.post.ap_id,
    image: p.post.thumbnail_url,
    date: p.post.published?.slice(0, 10),
    meta: { sub: `!${p.community?.name}`, score: p.counts?.score ?? 0, comments: p.counts?.comments ?? 0 },
  }));
};

const SE_SITES = ['skeptics', 'history', 'stackoverflow'];

export const stackexchange: SearchFn = async (q, { limit, signal }) => {
  const per = Math.max(2, Math.ceil(limit / 2));
  const results = await Promise.allSettled(
    SE_SITES.map((site) =>
      getJson(
        `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${enc(q)}&site=${site}&pagesize=${per}&filter=withbody`,
        { signal },
      ).then((j) => (j.items ?? []).map((it: any) => ({ ...it, _site: site }))),
    ),
  );
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  items.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));
  return items.slice(0, limit).map((it: any) => ({
    id: `stackexchange:${it._site}:${it.question_id}`,
    source: 'stackexchange',
    kind: 'post' as const,
    title: stripHtml(it.title, 200),
    snippet: stripHtml(it.body, 300),
    url: it.link,
    date: it.creation_date ? new Date(it.creation_date * 1000).toISOString().slice(0, 10) : undefined,
    meta: { sub: it._site, score: it.score ?? 0, comments: it.answer_count ?? 0 },
  }));
};
