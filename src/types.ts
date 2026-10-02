import type { Edge, Node } from '@xyflow/react';
import type { EntityType, ItemKind, SourceItem } from '../shared/types';

export type ClueType =
  | 'topic'
  | 'entity'
  | 'note'
  | 'image'
  | 'clip'
  | 'post'
  | 'video'
  | 'tangent'
  | 'question'
  | 'quote'
  | 'map'
  | 'label'
  | 'gallery'
  /** A labelled area that groups cards ("Suspects", "Theory A"); moving it moves what's inside. */
  | 'frame';

export interface MapPoint {
  lat: number;
  lon: number;
  label: string;
  nodeId?: string;
  mark?: 'circle' | 'x';
}

export type ClueData = {
  title: string;
  text?: string;
  image?: string;
  url?: string;
  source?: string;
  kind?: ItemKind;
  entityType?: EntityType;
  date?: string;
  author?: string;
  lat?: number;
  lon?: number;
  color?: string;
  pin?: string;
  rotation?: number;
  meta?: Record<string, string | number>;
  media?: SourceItem['media'];
  query?: string;
  hook?: string;
  /** A correction to the search that opened this case ("no source connects Storm8…"). */
  premise?: string;
  status?: 'digging' | 'done' | 'error';
  statusText?: string;
  depth?: number;
  provider?: string;
  clusterId?: string;
  explored?: boolean;
  caseNo?: number;
  points?: MapPoint[];
  width?: number;
  height?: number;
  /** A gallery card's portraits (a wiki's list of characters, members…). */
  items?: { title: string; image?: string; url?: string; role?: string }[];
  /** Good finds that didn't make the case's hand-picked board, one click from being pinned. */
  extras?: SourceItem[];
  /** A who's-who card that already holds its list's every member. */
  listComplete?: boolean;
  /** A rubber stamp on the card: what you have decided about this piece of evidence. */
  stamp?: Stamp;
  /** A coloured band across the top of the card, for your own colour-coding. */
  tint?: string;
  /** How the card is fixed to the board. */
  pinStyle?: PinStyle;
  /** Pinned while a dig is still running and not yet vetted by the AI: drawn faded, marked "checking". */
  vetting?: boolean;
};

export type Stamp = 'confirmed' | 'disputed' | 'debunked' | 'theory' | 'key' | 'lead';
export type PinStyle = 'pin' | 'tack' | 'tape' | 'clip';

export type ClueNode = Node<ClueData, ClueType>;

export type StringKind = 'relation' | 'evidence' | 'tangent' | 'user';

export type StringData = {
  label?: string;
  color?: string;
  dashed?: boolean;
  kind?: StringKind;
  /** Thread thickness in pixels (default by kind). */
  width?: number;
};

export type StringEdge = Edge<StringData, 'string'>;

export interface TrailStep {
  nodeId: string;
  title: string;
  depth: number;
  at: number;
}

export interface TimelineEntry {
  id: string;
  date: string;
  event: string;
  clusterId: string;
  /** The card that shows this moment happened (an article, a thread, a wiki page). */
  nodeId?: string;
}

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceItem[];
  provider?: string;
  error?: boolean;
  pending?: boolean;
  status?: string;
  /** What the partner did on the board for this answer. */
  done?: string[];
}

export interface Board {
  id: string;
  name: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
  nodes: ClueNode[];
  edges: StringEdge[];
  timeline: TimelineEntry[];
  trail: TrailStep[];
  chat: ChatEntry[];
  caseCounter: number;
}
