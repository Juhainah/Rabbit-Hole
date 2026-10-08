// Where a good researcher looks first, by the kind of topic. The search-reading step says what kind of
// topic a search is; each kind brings the places that really document or argue about it, and the order
// the board fills in. (The case's own fan wiki is found separately, for every kind that has one.)

export type TopicKind = 'screen' | 'game' | 'book' | 'music' | 'crime' | 'mystery' | 'lore' | 'person' | 'event' | 'science' | 'place' | 'other';

export const KINDS: TopicKind[] = ['screen', 'game', 'book', 'music', 'crime', 'mystery', 'lore', 'person', 'event', 'science', 'place', 'other'];

interface Play {
  /** Sites searched for the subject (domains, or r/subreddit). */
  sites: string[];
  /** What a case of this kind is told with, best first: shapes which finds the board keeps. */
  prefer: ('wiki' | 'news' | 'threads' | 'videos' | 'records' | 'papers' | 'pages')[];
}

export const PLAYBOOK: Record<TopicKind, Play> = {
  // Films, series, anime: production trivia, tropes and the fans' theories.
  screen: { sites: ['imdb.com', 'tvtropes.org', 'reddit.com'], prefer: ['wiki', 'threads', 'pages', 'videos', 'news'] },
  // Games and apps: cut and hidden content, lost versions, the players' forums.
  game: { sites: ['tcrf.net', 'lostmediawiki.com', 'reddit.com', 'gamefaqs.gamespot.com'], prefer: ['wiki', 'threads', 'videos', 'pages', 'news'] },
  book: { sites: ['goodreads.com', 'tvtropes.org', 'reddit.com'], prefer: ['wiki', 'pages', 'threads', 'news'] },
  music: { sites: ['genius.com', 'discogs.com', 'reddit.com'], prefer: ['pages', 'news', 'threads', 'videos', 'wiki'] },
  // Crimes: reporting from the time, court records, the sleuthing communities.
  crime: { sites: ['websleuths.com', 'reddit.com/r/UnresolvedMysteries', 'charleyproject.org', 'courtlistener.com'], prefer: ['news', 'records', 'threads', 'pages', 'videos'] },
  // Unexplained events and conspiracies: original documents, debunks, the forums that argue them.
  mystery: { sites: ['reddit.com/r/UnresolvedMysteries', 'vault.fbi.gov', 'metabunk.org', 'snopes.com'], prefer: ['records', 'pages', 'threads', 'news', 'videos'] },
  // Internet lore and lost media.
  lore: { sites: ['lostmediawiki.com', 'knowyourmeme.com', 'reddit.com'], prefer: ['wiki', 'threads', 'videos', 'pages'] },
  person: { sites: ['reddit.com'], prefer: ['news', 'pages', 'videos', 'threads'] },
  event: { sites: ['reddit.com/r/AskHistorians', 'loc.gov'], prefer: ['news', 'records', 'pages', 'threads'] },
  science: { sites: ['plato.stanford.edu', 'britannica.com'], prefer: ['papers', 'pages', 'videos', 'threads'] },
  place: { sites: ['atlasobscura.com', 'reddit.com'], prefer: ['pages', 'news', 'threads'] },
  other: { sites: ['reddit.com'], prefer: ['pages', 'news', 'threads', 'videos'] },
};

/** The sites to search: the AI's own picks for this subject first, then the kind's usual places. */
export function sitesFor(kind: TopicKind | undefined, picked: string[], max = 4): string[] {
  const out: string[] = [];
  const key = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  for (const s of [...picked, ...(kind ? PLAYBOOK[kind].sites : [])]) {
    const k = key(s);
    if (k && !out.some((o) => key(o) === k)) out.push(s);
  }
  return out.slice(0, max);
}
