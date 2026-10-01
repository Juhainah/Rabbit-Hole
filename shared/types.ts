// Types shared by the server (research engine) and the client (board).

export type ItemKind =
  | 'article'
  | 'image'
  | 'post'
  | 'paper'
  | 'book'
  | 'video'
  | 'audio'
  | 'place'
  | 'news'
  | 'record'
  | 'entity'
  | 'code'
  | 'quote'
  | 'definition'
  | 'artwork'
  | 'dataset'
  | 'legal'
  | 'media';

export interface SourceItem {
  id: string;
  source: string;
  kind: ItemKind;
  title: string;
  snippet?: string;
  url?: string;
  image?: string;
  date?: string;
  author?: string;
  lat?: number;
  lon?: number;
  /** Small extra facts shown on cards: subreddit, score, duration, license… */
  meta?: Record<string, string | number>;
  /** Direct media (mp3, embeddable video id) when the source offers it. */
  media?: { type: 'youtube' | 'archive' | 'audio'; src: string };
}

export type EntityType =
  | 'person'
  | 'place'
  | 'org'
  | 'event'
  | 'concept'
  | 'object'
  | 'work'
  | 'date';

export interface Entity {
  name: string;
  type: EntityType;
  description: string;
  date?: string;
  place?: string;
}

export interface Relation {
  from: string;
  to: string;
  label: string;
}

export interface Tangent {
  title: string;
  hook: string;
  query: string;
}

export interface TimelineItem {
  date: string;
  event: string;
}

export interface Analysis {
  title: string;
  summary: string;
  hook: string;
  entities: Entity[];
  relations: Relation[];
  timeline: TimelineItem[];
  tangents: Tangent[];
  questions: string[];
  /** Evidence numbers the AI judged off-topic (server-internal). */
  offtopic?: number[];
  /** Evidence numbers the AI chose for the board, best first (server-internal). */
  keep?: number[];
  /** Key evidence and the card it supports, with what it shows ("first account of the chat's removal"). */
  cites?: { item: string; entity: string; label?: string }[];
  /** Evidence numbers behind `cites`, before the server maps them to items (server-internal). */
  citations?: { evidence: number; entity: string; label?: string }[];
  /** A correction to the search itself: a name no source connects, a likely mix-up, or "almost nothing found". */
  premise?: string;
}

export interface Primary {
  title: string;
  extract: string;
  url?: string;
  image?: string;
  lat?: number;
  lon?: number;
  related?: string[];
  source: string;
}

export interface EntityEnrichment {
  image?: string;
  url?: string;
  lat?: number;
  lon?: number;
  extract?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  model: string;
}

/** Events streamed (as NDJSON) from /api/dig. */
export type DigEvent =
  | { type: 'status'; message: string; level?: 'info' | 'warn' }
  | { type: 'source-start'; source: string }
  /** `limit`: how many of these to pin (research batches are pinned whole, then curated). */
  | { type: 'source'; source: string; items: SourceItem[]; limit?: number }
  | { type: 'source-error'; source: string; error: string }
  | { type: 'primary'; primary: Primary }
  | { type: 'analysis'; analysis: Analysis }
  | { type: 'enrich'; entities: Record<string, EntityEnrichment> }
  /** Extra photos for the board (Wikimedia Commons, Openverse), pinned as polaroids. */
  | { type: 'photos'; items: SourceItem[] }
  /** Recordings and films (Internet Archive, podcasts), pinned as playable tapes. */
  | { type: 'media'; items: SourceItem[] }
  /** Preview images found on the web pages behind text clues, keyed by item id. */
  | { type: 'thumbs'; images: Record<string, string> }
  /** Item ids the AI judged off-topic; the board unpins them. */
  | { type: 'prune'; ids: string[] }
  /** Item ids that are good but not the best: moved off the board into the case's "More finds". */
  | { type: 'extras'; ids: string[] }
  /** A who's-who list from the subject's wiki (characters, members), pinned as one card of portraits. */
  | { type: 'gallery'; gallery: { title: string; url: string; source: string; items: SourceItem[] } }
  | { type: 'error'; message: string }
  /** Heartbeat so the client can tell a slow answer from a dead connection. */
  | { type: 'ping' }
  | { type: 'done' };

/** Events streamed (as NDJSON) from /api/chat. */
export type ChatEvent =
  | { type: 'status'; message: string }
  | { type: 'sources'; items: SourceItem[] }
  | { type: 'delta'; text: string }
  | { type: 'error'; message: string }
  | { type: 'ping' }
  | { type: 'done' };

export interface DigRequest {
  topic: string;
  url?: string;
  trail?: string[];
  /** The case this dig was opened from ("rotten.com" when digging into Jean Colombe from it). */
  caseQuery?: string;
  sources: string[];
  perSource?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  context?: string;
  research?: boolean;
  sources?: string[];
  /** Sources from the previous answer, so "pin that picture" can refer back to them. */
  carrySources?: SourceItem[];
  /** What the conversation is about (selected card or latest case), for searching. */
  hint?: string;
}

export interface ScrapeResult {
  url: string;
  finalUrl: string;
  title: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  text: string;
  image?: string;
  images: string[];
  links: { href: string; text: string }[];
  published?: string;
  via: 'direct' | 'reader' | 'wayback' | 'api';
  archivedAt?: string;
  /** Text is markdown (from the reader service) rather than plain paragraphs. */
  format?: 'text' | 'markdown';
  /** Couldn't get real content: a login wall, bot check or dead page. */
  blocked?: boolean;
  note?: string;
  media?: SourceItem['media'];
  comments?: { author?: string; text: string; score?: number; depth?: number }[];
  alternatives?: { label: string; url: string }[];
}
