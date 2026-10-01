import type { ScrapeResult } from '../../shared/types';

// Reddit and its archives refuse requests from cloud servers, but not from people's
// browsers. So the Reader fetches Reddit threads here, from the PullPush archive,
// which allows it.

export const redditThreadId = (url: string) => url.match(/reddit\.com\/r\/[^/]+\/comments\/([a-z0-9]+)/i)?.[1];

interface PullPushPost {
  title?: string;
  subreddit?: string;
  author?: string;
  created_utc?: number;
  selftext?: string;
  url?: string;
}
interface PullPushComment {
  body?: string;
  author?: string;
  score?: number;
  parent_id?: string;
}

export async function readRedditInBrowser(url: string, signal?: AbortSignal): Promise<ScrapeResult | null> {
  const id = redditThreadId(url);
  if (!id) return null;
  const get = async <T,>(path: string): Promise<T[]> => {
    const res = await fetch(`https://api.pullpush.io/reddit/search/${path}`, { signal });
    if (!res.ok) return [];
    return ((await res.json()) as { data?: T[] }).data ?? [];
  };
  const [posts, comments] = await Promise.all([get<PullPushPost>(`submission/?ids=${id}`), get<PullPushComment>(`comment/?link_id=${id}&size=100`).catch(() => [])]);
  const p = posts[0];
  if (!p) return null;
  const removed = (s?: string) => !s || s === '[removed]' || s === '[deleted]';
  return {
    url,
    finalUrl: url,
    title: p.title || 'Reddit thread',
    siteName: p.subreddit ? `r/${p.subreddit}` : 'Reddit',
    byline: p.author ? `u/${p.author}` : undefined,
    published: p.created_utc ? new Date(p.created_utc * 1000).toISOString().slice(0, 10) : undefined,
    text: !removed(p.selftext)
      ? p.selftext!
      : p.url && !p.url.includes('reddit.com')
        ? `Link post: ${p.url}`
        : "_The post's own text was removed. Here is what people said underneath._",
    format: 'markdown',
    images: [],
    links: [],
    via: 'api',
    comments: comments
      .filter((c) => !removed(c.body))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 40)
      .map((c) => ({ author: c.author, text: c.body!, score: c.score, depth: c.parent_id?.startsWith('t3_') ? 0 : 1 })),
    note: 'Read from the PullPush Reddit archive, so scores may be out of date.',
  };
}
