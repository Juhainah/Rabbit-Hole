import { sourceMeta } from '../../shared/sources';
import type { ClueNode, ClueType, StringEdge } from '../types';
import { centerOf, SIZE, sizeOf, type Point } from './factory';
import { lonLatToWorld, yearOf } from './utils';

const TAU = Math.PI * 2;
const GOLDEN = 2.399963229728653; // radians

/** Case layout: people/places close in, then the leads (rabbit holes + questions), then evidence, map on top. */
export const RING = { entity: 500, leads: 860, evidence: 1200, map: 1225 };

/** Leads start just right of straight-up so they never sit under the map. */
export const LEADS_OFFSET = -Math.PI / 2 + 0.35;

export function ringPos(c: Point, r: number, i: number, n: number, offset = -Math.PI / 2): Point {
  const a = offset + (TAU * i) / Math.max(1, n);
  return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
}

/** Evidence spirals outward on the golden angle, leaving the top free for the map. */
export function evidencePos(c: Point, i: number): Point {
  let a = i * GOLDEN + 0.35;
  const deg = (((a * 180) / Math.PI) % 360 + 360) % 360;
  if (deg > 238 && deg < 302) a += 1.2;
  const r = RING.evidence + (i % 3) * 185 + Math.floor(i / 9) * 150;
  return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r * 0.86 };
}

/** Where a new case file goes: away from the rest of the board, near its parent. */
export function clusterCenter(nodes: ClueNode[], parent?: ClueNode): Point {
  if (!nodes.length) return { x: 0, y: 0 };
  const topics = nodes.filter((n) => n.type === 'topic').map(centerOf);
  const all = nodes.map(centerOf);
  const centroid = {
    x: all.reduce((s, p) => s + p.x, 0) / all.length,
    y: all.reduce((s, p) => s + p.y, 0) / all.length,
  };
  if (parent) {
    const p = centerOf(parent);
    let base = Math.atan2(p.y - centroid.y, p.x - centroid.x);
    if (!Number.isFinite(base) || (p.x === centroid.x && p.y === centroid.y)) base = 0;
    for (const dist of [4700, 5600, 6600]) {
      for (let k = 0; k < 12; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const cand = { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
        if (topics.every((t) => Math.hypot(t.x - cand.x, t.y - cand.y) > 4500)) return cand;
      }
    }
  }
  const maxX = Math.max(...nodes.map((n) => n.position.x + sizeOf(n).w));
  const ys = nodes.map((n) => n.position.y);
  return { x: maxX + 2600, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export type ArrangeMode = 'radial' | 'timeline' | 'geo' | 'type' | 'source' | 'grid';

export const ARRANGE_LABEL: Record<ArrangeMode, string> = {
  radial: 'Case clusters',
  timeline: 'By date',
  geo: 'By location',
  type: 'By kind',
  source: 'By source',
  grid: 'Tidy grid',
};

const topLeft = (n: ClueNode, c: Point): Point => {
  const s = sizeOf(n);
  return { x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2) };
};

function columns(groups: [string, ClueNode[]][], origin: Point): Map<string, Point> {
  const out = new Map<string, Point>();
  let x = origin.x;
  for (const [, list] of groups) {
    let y = origin.y;
    const w = Math.max(...list.map((n) => sizeOf(n).w)) + 70;
    for (const n of list) {
      out.set(n.id, { x, y });
      y += sizeOf(n).h + 60;
    }
    x += w;
  }
  return out;
}

/** Re-lays the board out according to what the clues actually contain. */
export function arrange(nodes: ClueNode[], edges: StringEdge[], mode: ArrangeMode): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!nodes.length) return out;
  const origin = { x: Math.min(...nodes.map((n) => n.position.x)), y: Math.min(...nodes.map((n) => n.position.y)) };

  if (mode === 'grid') {
    const sorted = [...nodes].sort((a, b) => String(a.type).localeCompare(String(b.type)) || a.data.title.localeCompare(b.data.title));
    const cols = Math.ceil(Math.sqrt(sorted.length * 1.4));
    sorted.forEach((n, i) => out.set(n.id, { x: origin.x + (i % cols) * 330, y: origin.y + Math.floor(i / cols) * 340 }));
    return out;
  }

  if (mode === 'type') {
    const key = (n: ClueNode) => (n.type === 'entity' ? `entity:${n.data.entityType ?? 'concept'}` : String(n.type));
    const groups = new Map<string, ClueNode[]>();
    for (const n of nodes) groups.set(key(n), [...(groups.get(key(n)) ?? []), n]);
    return columns([...groups.entries()], origin);
  }

  if (mode === 'source') {
    const key = (n: ClueNode) => (n.data.source ? sourceMeta(n.data.source).name : n.type === 'topic' ? '0' : 'AI & notes');
    const groups = new Map<string, ClueNode[]>();
    for (const n of nodes) groups.set(key(n), [...(groups.get(key(n)) ?? []), n]);
    return columns([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)), origin);
  }

  if (mode === 'timeline') {
    const dated = nodes
      .map((n) => ({ n, y: yearOf(n.data.date) }))
      .filter((d): d is { n: ClueNode; y: number } => d.y != null)
      .sort((a, b) => a.y - b.y);
    const lanes = [0, 1, 2, 3];
    let x = origin.x;
    let lastYear = dated[0]?.y;
    dated.forEach(({ n, y }, i) => {
      // Big gaps in history get a little extra breathing room.
      if (lastYear != null && y - lastYear > 30) x += 180;
      lastYear = y;
      out.set(n.id, { x, y: origin.y + lanes[i % lanes.length] * 330 });
      x += 250;
    });
    const undated = nodes.filter((n) => !out.has(n.id));
    undated.forEach((n, i) => out.set(n.id, { x: origin.x + (i % 10) * 290, y: origin.y + 1500 + Math.floor(i / 10) * 330 }));
    return out;
  }

  if (mode === 'geo') {
    const geo = nodes.filter((n) => n.data.lat != null && n.data.lon != null);
    if (geo.length) {
      const z = 5;
      const pts = geo.map((n) => ({ n, p: lonLatToWorld(n.data.lat!, n.data.lon!, z) }));
      const minX = Math.min(...pts.map((d) => d.p.x));
      const minY = Math.min(...pts.map((d) => d.p.y));
      const scale = 2.2;
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const { n, p } of pts) {
        const s = sizeOf(n);
        let x = origin.x + (p.x - minX) * scale;
        let y = origin.y + (p.y - minY) * scale;
        // Nudge until nothing overlaps.
        for (let tries = 0; tries < 40 && placed.some((q) => x < q.x + q.w && x + s.w > q.x && y < q.y + q.h && y + s.h > q.y); tries++) {
          x += 60 * Math.cos(tries);
          y += 60 * Math.sin(tries) + 30;
        }
        placed.push({ x, y, w: s.w + 30, h: s.h + 30 });
        out.set(n.id, { x, y });
      }
    }
    const rest = nodes.filter((n) => !out.has(n.id));
    rest.forEach((n, i) => out.set(n.id, { x: origin.x - 700 - Math.floor(i / 8) * 300, y: origin.y + (i % 8) * 320 }));
    return out;
  }

  // radial: rebuild each case cluster around its case file.
  const topics = nodes.filter((n) => n.type === 'topic');
  const byCluster = new Map<string, ClueNode[]>();
  for (const n of nodes) {
    const k = n.data.clusterId ?? '_loose';
    byCluster.set(k, [...(byCluster.get(k) ?? []), n]);
  }
  for (const t of topics) {
    const c = centerOf(t);
    out.set(t.id, topLeft(t, c));
    const members = (byCluster.get(t.data.clusterId ?? '') ?? []).filter((n) => n.id !== t.id);
    const ents = members.filter((n) => n.type === 'entity' && !n.data.kind);
    const qs = members.filter((n) => n.type === 'question');
    const tans = members.filter((n) => n.type === 'tangent');
    const maps = members.filter((n) => n.type === 'map');
    const ev = members.filter((n) => !ents.includes(n) && !qs.includes(n) && !tans.includes(n) && !maps.includes(n));
    ents.forEach((n, i) => out.set(n.id, topLeft(n, ringPos(c, RING.entity, i, ents.length))));
    const leads = [...tans, ...qs];
    leads.forEach((n, i) => out.set(n.id, topLeft(n, ringPos(c, RING.leads, i, leads.length, LEADS_OFFSET))));
    maps.forEach((n) => out.set(n.id, topLeft(n, { x: c.x, y: c.y - RING.map })));
    ev.forEach((n, i) => out.set(n.id, topLeft(n, evidencePos(c, i))));
  }
  const loose = byCluster.get('_loose') ?? [];
  const maxX = Math.max(...[...out.values()].map((p) => p.x), origin.x);
  loose.filter((n) => !out.has(n.id)).forEach((n, i) => out.set(n.id, { x: maxX + 900 + (i % 4) * 300, y: origin.y + Math.floor(i / 4) * 320 }));
  void edges;
  void SIZE;
  return out;
}

export const typeOrder: ClueType[] = ['topic', 'entity', 'map', 'image', 'clip', 'post', 'video', 'quote', 'question', 'tangent', 'note', 'label'];
