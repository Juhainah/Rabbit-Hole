// Metadata for every research source. The server implements them in server/sources,
// the client uses this list for badges, toggles and grouping.

export type SourceGroup =
  | 'Knowledge'
  | 'Archives'
  | 'Museums'
  | 'Academic'
  | 'Community'
  | 'News'
  | 'Web'
  | 'Media'
  | 'Places'
  | 'Records'
  | 'Weird';

export interface SourceMeta {
  id: string;
  name: string;
  group: SourceGroup;
  glyph: string;
  color: string;
  description: string;
  /** Included in automatic digs by default. */
  dig: boolean;
  /** Takes a URL or domain rather than a topic. */
  wantsUrl?: boolean;
  /** Hidden until the server owner adds this key. */
  needsKey?: string;
  /** Other names people know it by, so "any data.gov stuff?" finds the Smithsonian cards. */
  aka?: string;
}

export const SOURCES: SourceMeta[] = [
  // Knowledge
  { id: 'wikipedia', name: 'Wikipedia', group: 'Knowledge', glyph: 'W', color: '#d4d4d4', description: 'Encyclopedia articles, images and coordinates', dig: true },
  { id: 'wikidata', name: 'Wikidata', group: 'Knowledge', glyph: 'WD', color: '#339966', description: 'Structured facts about people, places, things', dig: false },
  { id: 'wikiquote', name: 'Wikiquote', group: 'Knowledge', glyph: '“', color: '#9ca3af', description: 'Quotes by and about the topic', dig: false },
  { id: 'wiktionary', name: 'Wiktionary', group: 'Knowledge', glyph: 'Wt', color: '#a3a3a3', description: 'Definitions of a word or phrase', dig: false },
  { id: 'commons', name: 'Wikimedia Commons', group: 'Knowledge', glyph: 'C', color: '#3b82c4', description: 'Free photos, scans, maps and diagrams', dig: true },
  { id: 'wikisource', name: 'Wikisource', group: 'Knowledge', glyph: 'WS', color: '#8b8b8b', description: 'Primary documents: letters, treaties, speeches', dig: false },
  { id: 'urbandictionary', name: 'Urban Dictionary', group: 'Knowledge', glyph: 'UD', color: '#1d2439', description: 'Slang and internet lore', dig: false },
  { id: 'sep', name: 'Stanford Encyclopedia of Philosophy', group: 'Knowledge', glyph: 'SEP', color: '#8c1515', description: 'Deep philosophy entries', dig: false },

  // Archives
  { id: 'archive', name: 'Internet Archive', group: 'Archives', glyph: 'IA', color: '#e8e1d0', description: 'Books, films, audio, software, scans', dig: true },
  { id: 'wayback', name: 'Wayback Machine', group: 'Archives', glyph: 'WB', color: '#b0a07a', description: 'Yearly snapshots of a URL or domain', dig: false, wantsUrl: true },
  { id: 'openlibrary', name: 'Open Library', group: 'Archives', glyph: 'OL', color: '#e5a54b', description: 'Books and authors', dig: true },
  { id: 'gutenberg', name: 'Project Gutenberg', group: 'Archives', glyph: 'PG', color: '#b45309', description: 'Public-domain books (full text)', dig: false },
  { id: 'europeana', name: 'Europeana', group: 'Archives', glyph: 'EU', color: '#0a72cc', description: 'European libraries, archives and museums', dig: false },
  { id: 'ukarchives', name: 'UK National Archives', group: 'Archives', glyph: 'NA', color: '#6b7280', description: 'Government records and files', dig: false },
  { id: 'declassified', name: 'Declassified files', group: 'Archives', glyph: 'FOIA', color: '#b91c1c', description: 'CIA reading room, FBI vault, NSA archive', dig: false },
  { id: 'blackvault', name: 'The Black Vault', group: 'Archives', glyph: 'BV', color: '#111827', description: 'Millions of pages of FOIA releases', dig: false },
  { id: 'muckrock', name: 'MuckRock', group: 'Archives', glyph: 'MR', color: '#2b6cb0', description: 'Public-records requests and documents', dig: false },
  { id: 'dtic', name: 'DTIC', group: 'Archives', glyph: 'DoD', color: '#4b5563', description: 'US defense technical reports', dig: false },
  { id: 'smithsonianmag', name: 'Smithsonian Magazine', group: 'Archives', glyph: 'SM', color: '#f59e0b', description: 'Long-form history and science stories', dig: false },

  // Museums
  { id: 'smithsonian', name: 'Smithsonian', group: 'Museums', glyph: 'SI', color: '#e11d48', description: 'Objects, specimens and archives', dig: true, aka: 'US government open data, via data.gov' },
  { id: 'met', name: 'The Met', group: 'Museums', glyph: 'MET', color: '#dc2626', description: 'Metropolitan Museum open-access art', dig: false },
  { id: 'artic', name: 'Art Institute Chicago', group: 'Museums', glyph: 'AIC', color: '#b91c1c', description: 'Artworks with high-res images', dig: false },
  { id: 'cleveland', name: 'Cleveland Museum', group: 'Museums', glyph: 'CMA', color: '#0f766e', description: 'Open-access artworks', dig: false },
  { id: 'vam', name: 'V&A Museum', group: 'Museums', glyph: 'V&A', color: '#171717', description: 'Design, fashion and decorative arts', dig: false },
  { id: 'wellcome', name: 'Wellcome Collection', group: 'Museums', glyph: 'WC', color: '#15803d', description: 'Medicine, the body and the strange', dig: false },

  // Academic
  { id: 'openalex', name: 'OpenAlex', group: 'Academic', glyph: 'OA', color: '#f97316', description: '250M+ scholarly works', dig: true },
  { id: 'arxiv', name: 'arXiv', group: 'Academic', glyph: 'aX', color: '#b31b1b', description: 'Physics, math, CS preprints', dig: false },
  { id: 'crossref', name: 'Crossref', group: 'Academic', glyph: 'CR', color: '#3eb1c8', description: 'DOIs and publication metadata', dig: false },
  { id: 'europepmc', name: 'Europe PMC / PubMed', group: 'Academic', glyph: 'PM', color: '#2563eb', description: 'Biomedical and life-science papers', dig: false },
  { id: 'semanticscholar', name: 'Semantic Scholar', group: 'Academic', glyph: 'S2', color: '#1857b6', description: 'Papers with citation counts (rate limited)', dig: false },
  { id: 'zenodo', name: 'Zenodo', group: 'Academic', glyph: 'Z', color: '#1682d4', description: 'Research datasets and uploads', dig: false },
  { id: 'oeis', name: 'OEIS', group: 'Academic', glyph: 'Σ', color: '#7c3aed', description: 'Integer sequences (math rabbit holes)', dig: false },

  // Community
  { id: 'reddit', name: 'Reddit', group: 'Community', glyph: 'r/', color: '#ff4500', description: 'Threads and theories', dig: true },
  { id: 'hackernews', name: 'Hacker News', group: 'Community', glyph: 'Y', color: '#ff6600', description: 'Tech discussions', dig: true },
  { id: 'lemmy', name: 'Lemmy', group: 'Community', glyph: 'L', color: '#00bc8c', description: 'Fediverse forum posts', dig: true },
  { id: 'forums', name: 'Forums', group: 'Community', glyph: '💬', color: '#8b5cf6', description: 'AboveTopSecret, Unexplained Mysteries, 4chan /x/ archive, MetaFilter, Quora and more', dig: true },
  { id: 'stackexchange', name: 'Stack Exchange', group: 'Community', glyph: 'SE', color: '#f48024', description: 'Skeptics, History and Stack Overflow Q&A', dig: false },

  // News
  { id: 'googlenews', name: 'Google News', group: 'News', glyph: 'GN', color: '#4285f4', description: 'Recent news coverage', dig: true },
  { id: 'gdelt', name: 'GDELT', group: 'News', glyph: 'GD', color: '#0891b2', description: 'Global news monitor (slow, rate limited)', dig: false },

  // Web
  { id: 'web', name: 'Web', group: 'Web', glyph: 'DDG', color: '#de5833', description: 'General web search', dig: true },
  { id: 'wiby', name: 'Wiby (old web)', group: 'Web', glyph: 'wb', color: '#a3e635', description: 'Search engine for the classic, handmade web', dig: false },
  { id: 'github', name: 'GitHub', group: 'Web', glyph: 'GH', color: '#e5e7eb', description: 'Code repositories', dig: true },

  // Media
  { id: 'youtube', name: 'YouTube', group: 'Media', glyph: '▶', color: '#ff0033', description: 'Videos, documentaries, video essays (+ transcripts)', dig: true },
  { id: 'dailymotion', name: 'Dailymotion', group: 'Media', glyph: 'dm', color: '#0066dc', description: 'More videos, often old TV rips', dig: false },
  { id: 'podcasts', name: 'Podcasts', group: 'Media', glyph: '🎙', color: '#a855f7', description: 'Podcast episodes (Apple directory)', dig: false },
  { id: 'openverse', name: 'Openverse', group: 'Media', glyph: 'OV', color: '#c026d3', description: 'Openly licensed images', dig: false },
  { id: 'nasa', name: 'NASA Images', group: 'Media', glyph: 'NASA', color: '#0b3d91', description: 'NASA photo and video library', dig: false },
  { id: 'tvmaze', name: 'TV Maze', group: 'Media', glyph: 'TV', color: '#3c948b', description: 'TV shows and documentaries', dig: false },
  { id: 'musicbrainz', name: 'MusicBrainz', group: 'Media', glyph: 'MB', color: '#ba478f', description: 'Artists and bands', dig: false },

  // Weird: the actual rabbit holes
  { id: 'atlasobscura', name: 'Atlas Obscura', group: 'Weird', glyph: 'AO', color: '#c9a227', description: 'Strange places and hidden wonders', dig: true },
  { id: 'lostmedia', name: 'Lost Media Wiki', group: 'Weird', glyph: 'LM', color: '#7c3aed', description: 'Missing films, broadcasts, games', dig: false },
  { id: 'scp', name: 'SCP Wiki', group: 'Weird', glyph: 'SCP', color: '#9f1239', description: 'Collaborative anomaly fiction', dig: false },
  { id: 'tvtropes', name: 'TV Tropes', group: 'Weird', glyph: 'TT', color: '#1e40af', description: 'The most dangerous wiki on the internet', dig: false },
  { id: 'rationalwiki', name: 'RationalWiki', group: 'Weird', glyph: 'RW', color: '#16a34a', description: 'Skeptical takes on conspiracies and pseudoscience', dig: false },
  { id: 'snopes', name: 'Snopes', group: 'Weird', glyph: 'SN', color: '#1d4ed8', description: 'Fact checks and urban legends', dig: false },
  { id: 'knowyourmeme', name: 'Know Your Meme', group: 'Weird', glyph: 'KYM', color: '#12284b', description: 'Internet culture and meme origins', dig: false },
  { id: 'truecrime', name: 'True crime (Websleuths, Doe Network)', group: 'Weird', glyph: 'TC', color: '#991b1b', description: 'Cold cases and unidentified persons', dig: false },
  { id: 'fandom', name: 'Fandom wikis', group: 'Weird', glyph: 'FW', color: '#fa005a', description: 'Deep lore from every fandom', dig: false },
  { id: 'bellingcat', name: 'Bellingcat', group: 'Weird', glyph: 'BC', color: '#ea580c', description: 'Open-source investigations', dig: false },
  { id: 'aleph', name: 'OCCRP Aleph', group: 'Weird', glyph: 'OC', color: '#dc2626', description: 'Leaks, company registries, investigations', dig: false, needsKey: 'ALEPH_API_KEY' },
  { id: 'damninteresting', name: 'Damn Interesting', group: 'Weird', glyph: 'DI', color: '#65a30d', description: 'Long reads on true, strange history', dig: false },
  { id: 'futilitycloset', name: 'Futility Closet', group: 'Weird', glyph: 'FC', color: '#a16207', description: 'Curiosities, puzzles, odd facts', dig: false },
  { id: 'publicdomainreview', name: 'Public Domain Review', group: 'Weird', glyph: 'PDR', color: '#be123c', description: 'Forgotten art, books and oddities', dig: false },
  { id: 'cryptome', name: 'Cryptome', group: 'Weird', glyph: 'CR', color: '#525252', description: 'Leaked and declassified document library', dig: false },
  { id: 'substack', name: 'Substack', group: 'Weird', glyph: 'SS', color: '#ff6719', description: 'Independent newsletters and essays', dig: false },

  // Places
  { id: 'places', name: 'OpenStreetMap', group: 'Places', glyph: 'OSM', color: '#7ebc6f', description: 'Geocode a place name', dig: false },
  { id: 'nearby', name: 'Nearby (Wikipedia)', group: 'Places', glyph: '⌖', color: '#22c55e', description: 'Articles about things near a place', dig: false },
  { id: 'inaturalist', name: 'iNaturalist', group: 'Places', glyph: 'iN', color: '#74ac00', description: 'Species and creatures', dig: false },

  // Records
  { id: 'courtlistener', name: 'CourtListener', group: 'Records', glyph: '⚖', color: '#b45309', description: 'US court opinions', dig: true },
  { id: 'fedregister', name: 'Federal Register', group: 'Records', glyph: 'FR', color: '#1e3a8a', description: 'US rules, notices, executive orders', dig: false },
  { id: 'sec', name: 'SEC EDGAR', group: 'Records', glyph: 'SEC', color: '#334155', description: 'Company filings full-text search', dig: false },
  { id: 'fbi', name: 'FBI Wanted', group: 'Records', glyph: 'FBI', color: '#1f2937', description: 'Wanted and missing persons notices', dig: false },
];

export const SOURCE_GROUPS: SourceGroup[] = [
  'Knowledge',
  'Archives',
  'Museums',
  'Academic',
  'Community',
  'News',
  'Web',
  'Media',
  'Weird',
  'Places',
  'Records',
];

/** Evidence the user added themselves (their photos, PDFs, notes). Not a searchable archive. */
const MINE: SourceMeta = { id: 'mine', name: 'Your evidence', group: 'Web', glyph: 'ME', color: '#6b5d4f', description: 'Added by you', dig: false };

export const sourceMeta = (id: string): SourceMeta =>
  (id === 'mine' ? MINE : SOURCES.find((s) => s.id === id)) ?? {
    id,
    name: id,
    group: 'Web',
    glyph: '?',
    color: '#888',
    description: '',
    dig: false,
  };
