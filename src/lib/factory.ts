import { nanoid } from 'nanoid';
import type { SourceItem } from '../../shared/types';
import type { ClueData, ClueNode, ClueType, StringData, StringEdge } from '../types';
import { jitterRot } from './utils';

/** Approximate rendered sizes, used for layout before React Flow measures nodes. */
export const SIZE: Record<ClueType, { w: number; h: number }> = {
  topic: { w: 360, h: 460 },
  entity: { w: 244, h: 220 },
  note: { w: 210, h: 200 },
  image: { w: 224, h: 280 },
  clip: { w: 260, h: 240 },
  post: { w: 262, h: 200 },
  video: { w: 272, h: 240 },
  tangent: { w: 236, h: 210 },
  question: { w: 224, h: 150 },
  quote: { w: 250, h: 170 },
  map: { w: 540, h: 400 },
  label: { w: 150, h: 56 },
};

export type Point = { x: number; y: number };

/**
 * Layering: strings (0) always run behind every card, so text is never crossed out.
 * A selected card's strings brighten while the rest fade, but stay behind. Only a
 * string you click rises (RAISED_Z). The case file (2500) stays above everything.
 */
export const STRING_Z = 0;
export const RAISED_Z = 1500;
export const TOPIC_Z = 2500;

export function sizeOf(n: ClueNode) {
  return {
    w: n.measured?.width ?? n.width ?? SIZE[n.type as ClueType]?.w ?? 240,
    h: n.measured?.height ?? n.height ?? SIZE[n.type as ClueType]?.h ?? 200,
  };
}

export function centerOf(n: ClueNode): Point {
  const s = sizeOf(n);
  return { x: n.position.x + s.w / 2, y: n.position.y + s.h / 2 };
}

export function makeNode(type: ClueType, center: Point, data: ClueData, id = `${type.slice(0, 2)}-${nanoid(8)}`): ClueNode {
  const s = SIZE[type];
  const node: ClueNode = {
    id,
    type,
    position: { x: Math.round(center.x - s.w / 2), y: Math.round(center.y - s.h / 2) },
    data: { rotation: jitterRot(id), ...data },
  };
  if (type === 'topic') node.zIndex = TOPIC_Z;
  if (type === 'map') {
    node.width = s.w;
    node.height = s.h;
  }
  return node;
}

/**
 * Strings normally run over the cards like on a real board. `under` tucks a
 * string behind them: used for the dozens radiating from a case file, which
 * would otherwise cover its text.
 */
export function makeEdge(source: string, target: string, data: StringData = {}, targetHandle = 'pin', under = false): StringEdge {
  return {
    id: `e-${nanoid(8)}`,
    source,
    target,
    sourceHandle: 'pin',
    targetHandle,
    type: 'string',
    zIndex: under ? 0 : STRING_Z,
    data,
  };
}

export function typeForItem(item: SourceItem): ClueType {
  switch (item.kind) {
    case 'image':
    case 'artwork':
      return item.image ? 'image' : 'clip';
    case 'post':
      return 'post';
    case 'video':
    case 'audio':
    case 'media':
      return item.image || item.media ? 'video' : 'clip';
    case 'quote':
      return 'quote';
    case 'place':
    case 'entity':
      return 'entity';
    default:
      return 'clip';
  }
}

export function itemToData(item: SourceItem): ClueData {
  return {
    title: item.title,
    text: item.snippet,
    image: item.image,
    url: item.url,
    source: item.source,
    kind: item.kind,
    date: item.date,
    author: item.author,
    lat: item.lat,
    lon: item.lon,
    meta: item.meta,
    media: item.media,
    entityType: item.kind === 'place' ? 'place' : item.kind === 'entity' ? 'concept' : undefined,
  };
}

export const itemToNode = (item: SourceItem, center: Point, extra: Partial<ClueData> = {}) =>
  makeNode(typeForItem(item), center, { ...itemToData(item), ...extra });
