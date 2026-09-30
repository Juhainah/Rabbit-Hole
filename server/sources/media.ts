import { XMLParser } from 'fast-xml-parser';
import type { SourceItem } from '../../shared/types';
import { BROWSER_UA, enc, getJson, getText, stripHtml, throttle } from '../http';
import { arr, num, type SearchFn } from './types';

const YT_HEADERS = {
  'User-Agent': BROWSER_UA,
  Accept: 'text/html',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+1; SOCS=CAI',
};

const runs = (x: any): string => x?.simpleText ?? (x?.runs ?? []).map((r: any) => r.text).join('') ?? '';

function walk(node: any, visit: (n: any) => void, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  visit(node);
  for (const v of Array.isArray(node) ? node : Object.values(node)) walk(v, visit, depth + 1);
}

function ytItem(id: string, title: string, extra: Partial<SourceItem> = {}): SourceItem {
  return {
    id: `youtube:${id}`,
    source: 'youtube',
    kind: 'video',
    title,
    url: `https://www.youtube.com/watch?v=${id}`,
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    media: { type: 'youtube', src: id },
    ...extra,
  };
}

async function youtubeOfficial(q: string, limit: number, key: string, signal?: AbortSignal) {
  const j = await getJson(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${limit}&q=${enc(q)}&key=${key}`,
    { signal },
  );
  return (j.items ?? []).map((it: any) =>
    ytItem(it.id.videoId, stripHtml(it.snippet.title), {
      snippet: stripHtml(it.snippet.description, 300),
      author: it.snippet.channelTitle,
      date: it.snippet.publishedAt?.slice(0, 10),
    }),
  );
}

async function youtubeScrape(q: string, limit: number, signal?: AbortSignal): Promise<SourceItem[]> {
  const html = await getText(`https://www.youtube.com/results?search_query=${enc(q)}&hl=en&gl=US`, {
    signal,
    timeout: 12000,
    headers: YT_HEADERS,
  });
  const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) throw new Error('YouTube page format changed');
  const data = JSON.parse(m[1]);
  const out: SourceItem[] = [];
  const seen = new Set<string>();
  walk(data, (n) => {
    const v = n.videoRenderer;
    if (v?.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      out.push(
        ytItem(v.videoId, runs(v.title), {
          snippet: runs(v.detailedMetadataSnippets?.[0]?.snippetText) || runs(v.descriptionSnippet),
          author: runs(v.ownerText) || runs(v.longBylineText),
          date: runs(v.publishedTimeText) || undefined,
          meta: {
            ...(runs(v.lengthText) ? { length: runs(v.lengthText) } : {}),
            ...(runs(v.shortViewCountText) ? { views: runs(v.shortViewCountText) } : {}),
          },
        }),
      );
    }
    const l = n.lockupViewModel;
    if (l?.contentId && l.contentType?.includes('VIDEO') && !seen.has(l.contentId)) {
      seen.add(l.contentId);
      const md = l.metadata?.lockupMetadataViewModel;
      out.push(ytItem(l.contentId, md?.title?.content ?? 'Video'));
    }
  });
  return out.slice(0, limit);
}

export const youtube: SearchFn = async (q, { limit, signal }) => {
  const key = process.env.YOUTUBE_API_KEY;
  if (key) {
    try {
      return await youtubeOfficial(q, limit, key, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return youtubeScrape(q, limit, signal);
};

/** Pulls a video's captions so the AI can read the video. Best effort. */
export async function youtubeTranscript(id: string): Promise<{ title: string; text: string; lang: string }> {
  const html = await getText(`https://www.youtube.com/watch?v=${enc(id)}&hl=en`, { timeout: 15000, headers: YT_HEADERS });
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ - YouTube$/, '') ?? id;
  const tracksJson = html.match(/"captionTracks":(\[.*?\])/)?.[1];
  if (!tracksJson) throw new Error('This video has no captions.');
  const tracks: any[] = JSON.parse(tracksJson);
  const pick =
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ??
    tracks.find((t) => t.languageCode?.startsWith('en')) ??
    tracks[0];
  const url = String(pick.baseUrl).replace(/\\u0026/g, '&');
  const raw = await getText(`${url}&fmt=json3`, { timeout: 15000, headers: YT_HEADERS });
  let text = '';
  if (raw.trim().startsWith('{')) {
    const j = JSON.parse(raw);
    text = (j.events ?? [])
      .flatMap((e: any) => (e.segs ?? []).map((s: any) => s.utf8))
      .join('')
      .replace(/\s+/g, ' ');
  } else {
    text = stripHtml(raw.replace(/<\/text>/g, ' '), 200000);
  }
  if (!text.trim()) throw new Error('YouTube refused the captions request (try again later).');
  return { title: stripHtml(title), text: text.trim().slice(0, 60000), lang: pick.languageCode ?? '?' };
}

export const dailymotion: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://api.dailymotion.com/videos?search=${enc(q)}&limit=${limit}&fields=id,title,description,thumbnail_360_url,owner.screenname,created_time,duration,views_total,url`,
    { signal },
  );
  return (j.list ?? []).map((v: any) => ({
    id: `dailymotion:${v.id}`,
    source: 'dailymotion',
    kind: 'video' as const,
    title: v.title,
    snippet: stripHtml(v.description, 300),
    url: v.url,
    image: v.thumbnail_360_url,
    author: v['owner.screenname'],
    date: v.created_time ? new Date(v.created_time * 1000).toISOString().slice(0, 10) : undefined,
    meta: { length: `${Math.round((v.duration ?? 0) / 60)} min`, views: v.views_total ?? 0 },
  }));
};

export const podcasts: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(
    `https://itunes.apple.com/search?term=${enc(q)}&media=podcast&entity=podcastEpisode&limit=${limit}`,
    { signal },
  );
  return (j.results ?? []).map((e: any) => ({
    id: `podcasts:${e.trackId}`,
    source: 'podcasts',
    kind: 'audio' as const,
    title: e.trackName,
    snippet: stripHtml(e.description ?? e.shortDescription, 300),
    url: e.trackViewUrl,
    image: e.artworkUrl600 ?? e.artworkUrl160,
    author: e.collectionName,
    date: e.releaseDate?.slice(0, 10),
    media: e.episodeUrl ? { type: 'audio' as const, src: e.episodeUrl } : undefined,
    meta: e.trackTimeMillis ? { length: `${Math.round(e.trackTimeMillis / 60000)} min` } : undefined,
  }));
};

export const openverse: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://api.openverse.org/v1/images/?q=${enc(q)}&page_size=${limit}&mature=false`, {
    signal,
  });
  return (j.results ?? []).map((r: any) => ({
    id: `openverse:${r.id}`,
    source: 'openverse',
    kind: 'image' as const,
    title: r.title || 'Untitled image',
    image: r.thumbnail ?? r.url,
    url: r.foreign_landing_url ?? r.url,
    author: r.creator,
    meta: { license: `${r.license ?? ''} ${r.license_version ?? ''}`.trim(), from: r.source ?? '' },
  }));
};

export const nasa: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson(`https://images-api.nasa.gov/search?q=${enc(q)}&media_type=image&page_size=${limit}`, {
    signal,
  });
  return (j.collection?.items ?? []).slice(0, limit).map((it: any) => {
    const d = it.data?.[0] ?? {};
    return {
      id: `nasa:${d.nasa_id}`,
      source: 'nasa',
      kind: 'image' as const,
      title: d.title,
      snippet: stripHtml(d.description, 300),
      image: it.links?.[0]?.href,
      url: `https://images.nasa.gov/details/${d.nasa_id}`,
      date: d.date_created?.slice(0, 10),
      meta: d.center ? { center: d.center } : undefined,
    };
  });
};

export const tvmaze: SearchFn = async (q, { limit, signal }) => {
  const j = await getJson<any[]>(`https://api.tvmaze.com/search/shows?q=${enc(q)}`, { signal });
  return j.slice(0, limit).map(({ show: s }) => ({
    id: `tvmaze:${s.id}`,
    source: 'tvmaze',
    kind: 'media' as const,
    title: s.name,
    snippet: stripHtml(s.summary, 300),
    image: s.image?.medium,
    url: s.url,
    date: s.premiered,
    meta: { genres: (s.genres ?? []).join(', '), ...(s.network?.name ? { network: s.network.name } : {}) },
  }));
};

const mbQueue = throttle(1100);

export const musicbrainz: SearchFn = async (q, { limit, signal }) => {
  const j = await mbQueue(() => getJson(`https://musicbrainz.org/ws/2/artist?query=${enc(q)}&fmt=json&limit=${limit}`, { signal }));
  return (j.artists ?? []).map((a: any) => ({
    id: `musicbrainz:${a.id}`,
    source: 'musicbrainz',
    kind: 'entity' as const,
    title: a.name,
    snippet: [a.disambiguation, a.type, a.country, (a.tags ?? []).slice(0, 4).map((t: any) => t.name).join(', ')]
      .filter(Boolean)
      .join(' · '),
    url: `https://musicbrainz.org/artist/${a.id}`,
    date: a['life-span']?.begin,
  }));
};

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

export const googlenews: SearchFn = async (q, { limit, signal }) => {
  const text = await getText(`https://news.google.com/rss/search?q=${enc(q)}&hl=en-US&gl=US&ceid=US:en`, {
    signal,
    headers: { Accept: 'application/rss+xml' },
  });
  return arr(xml.parse(text)?.rss?.channel?.item)
    .slice(0, limit)
    .map((it: any) => {
      const src = typeof it.source === 'object' ? it.source['#text'] : it.source;
      const title = String(it.title ?? '').replace(new RegExp(`\\s-\\s${String(src ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      return {
        id: `googlenews:${it.guid?.['#text'] ?? it.link}`,
        source: 'googlenews',
        kind: 'news' as const,
        title: stripHtml(title, 240),
        snippet: src ? String(src) : '',
        url: String(it.link),
        date: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : undefined,
        meta: src ? { site: String(src) } : undefined,
      };
    });
};

const gdeltQueue = throttle(5500);

export const gdelt: SearchFn = async (q, { limit, signal }) => {
  const j = await gdeltQueue(() =>
    getJson(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(q)}&mode=artlist&format=json&maxrecords=${limit}&sort=hybridrel`,
      { signal, timeout: 20000 },
    ),
  );
  return (j.articles ?? []).map((a: any) => ({
    id: `gdelt:${a.url}`,
    source: 'gdelt',
    kind: 'news' as const,
    title: a.title,
    snippet: `${a.domain} · ${a.language ?? ''}`,
    url: a.url,
    image: a.socialimage || undefined,
    date: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : undefined,
    meta: { site: a.domain, views: num(a.sourcecountry) ?? 0 },
  }));
};
