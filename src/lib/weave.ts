import { currentBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import type { ClueNode, StringEdge } from '../types';
import { centerOf, makeEdge, sizeOf, type Point } from './factory';
import { RING, untangle } from './layout';
import { nameMatcher, tokenize } from './names';

// After the AI names the people, places and events, weave the evidence in:
// string each clue to the cards it mentions, then slide it next to them.

const EVIDENCE = new Set(['clip', 'post', 'video', 'image', 'quote']);
const LEADS = new Set(['question', 'tangent']);

/**
 * Strings each clue in a case to the index cards it mentions and, when
 * `arrange` is set, moves evidence to sit just outside the card it's about.
 */
export function weaveCase(clusterId: string, topicId: string, arrange = true) {
  const board = currentBoard();
  const topic = board.nodes.find((n) => n.id === topicId);
  if (!topic) return;
  const inCase = board.nodes.filter((n) => n.data.clusterId === clusterId);
  const entities = inCase.filter((n) => n.type === 'entity' && !n.data.kind);
  if (!entities.length) return;
  const keys = entities.map((e) => ({ id: e.id, match: nameMatcher(e.data.title, e.data.entityType === 'person') }));
  const linked = new Set(board.edges.map((e) => `${e.source}>${e.target}`));

  const edges: StringEdge[] = [];
  const home = new Map<string, string>(); // evidence id -> entity id it belongs next to
  for (const n of inCase) {
    if (!EVIDENCE.has(String(n.type)) && !LEADS.has(String(n.type))) continue;
    const title = tokenize(n.data.title);
    const toks = [...title, '', ...tokenize(`${n.data.text ?? ''} ${n.data.hook ?? ''} ${n.data.author ?? ''}`)];
    // Cards named in the clue's title come first: that's what the clue is about.
    const hits = keys
      .filter((k) => k.match(toks))
      .map((k) => ({ ...k, inTitle: k.match(title) }))
      .sort((a, b) => Number(b.inTitle) - Number(a.inTitle))
      .slice(0, 2);
    for (const h of hits) {
      if (linked.has(`${h.id}>${n.id}`) || linked.has(`${n.id}>${h.id}`)) continue;
      edges.push(makeEdge(h.id, n.id, { kind: 'evidence' }, 'pin', true));
    }
    if (hits[0] && EVIDENCE.has(String(n.type))) home.set(n.id, hits[0].id);
  }
  if (edges.length) useBoards.getState().addEdges(edges);
  if (!arrange) return edges.length;

  // Re-seat the evidence ring: clues sit behind the card they mention; the rest fill the gaps.
  const c = centerOf(topic);
  const angleOf = (p: Point) => Math.atan2(p.y - c.y, p.x - c.x);
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const evidence = inCase.filter((n) => EVIDENCE.has(String(n.type)));
  const wanted = evidence
    .map((n) => {
      const e = home.get(n.id);
      return { n, theta: angleOf(centerOf(e ? byId.get(e)! : n)) };
    })
    .sort((a, b) => a.theta - b.theta);

  const rings = [RING.evidence, RING.evidence + 230, RING.evidence + 460, RING.evidence + 690];
  const lastOnRing = rings.map(() => -Infinity);
  const positions = new Map<string, Point>();
  const mapTop = (t: number) => t > -2.13 && t < -1.01; // keep the top clear for the pinned map
  for (const { n, theta } of wanted) {
    let best = { ring: 0, t: theta, push: Infinity };
    for (let r = 0; r < rings.length; r++) {
      const gap = (sizeOf(n).w + 50) / rings[r];
      let t = Math.max(theta, lastOnRing[r] + gap);
      if (mapTop(t)) t = Math.max(t, -1.01 + gap / 2);
      const push = t - theta + r * 0.05;
      if (push < best.push) best = { ring: r, t, push };
    }
    lastOnRing[best.ring] = best.t;
    const s = sizeOf(n);
    const x = c.x + Math.cos(best.t) * rings[best.ring];
    const y = c.y + Math.sin(best.t) * rings[best.ring] * 0.88;
    positions.set(n.id, { x: Math.round(x - s.w / 2), y: Math.round(y - s.h / 2) });
  }

  // Finally make sure no two cards sit on top of each other (the case file and other cases stay put).
  const movable = new Set(inCase.filter((n) => n.id !== topicId).map((n) => n.id));
  const clear = untangle(currentBoard().nodes, movable, positions);
  for (const [id, p] of clear) positions.set(id, p);

  const ui = useUi.getState();
  ui.set({ arranging: true });
  useBoards.getState().updateNodes((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
  setTimeout(() => useUi.getState().set({ arranging: false }), 800);
  return edges.length;
}

// "The Mary Celeste" and "Mary Celeste" are the same name.
const nameKey = (s?: string) => (s ? tokenize(s).filter((w, i) => i > 0 || w !== 'the').join(' ') : '');
const wikiPage = (url?: string) => {
  const m = url?.match(/wikipedia\.org\/wiki\/([^#?]+)/);
  return m ? nameKey(decodeURIComponent(m[1]).replace(/_/g, ' ')) : '';
};

/**
 * Ties a new case to the rest of the board: its people and places to the same
 * ones in other cases, and to cases that are about them. A case is named by
 * what was searched ("Leonid Kulik"), not the AI's headline for it.
 */
export function linkAcrossCases(clusterId: string) {
  const board = currentBoard();
  const subjects = board.nodes.filter((n) => (n.type === 'entity' && !n.data.kind) || n.type === 'topic');
  const names = (n: ClueNode) => (n.type === 'topic' ? [nameKey(n.data.query)] : [nameKey(n.data.title)]).filter(Boolean);
  const fresh = subjects.filter((n) => n.data.clusterId === clusterId);
  const older = subjects.filter((n) => n.data.clusterId && n.data.clusterId !== clusterId);
  const linked = new Set(board.edges.map((e) => [e.source, e.target].sort().join('>')));
  const edges: StringEdge[] = [];
  // A page only vouches for a card whose name it contains, or that contains it ("Dyatlov Pass" / "Dyatlov Pass incident").
  const pageOf = (n: ClueNode) => {
    const page = wikiPage(n.data.url);
    const name = names(n)[0] ?? '';
    const a = page.split(' ');
    const b = name.split(' ');
    return page && name && (a.every((w) => b.includes(w)) || b.every((w) => a.includes(w))) ? page : '';
  };
  for (const f of fresh) {
    const fNames = names(f);
    const fPage = pageOf(f);
    // The same subject: same name, or the same Wikipedia page under a different name.
    const twin = older.find((o) => names(o).some((n) => fNames.includes(n)) || (!!fPage && pageOf(o) === fPage));
    if (!twin || (twin.type === 'topic' && f.type === 'topic')) continue;
    const pair = [twin.id, f.id].sort().join('>');
    if (linked.has(pair)) continue;
    linked.add(pair);
    const label = twin.type === 'topic' || f.type === 'topic' ? 'has its own case' : 'appears in both cases';
    edges.push(makeEdge(twin.id, f.id, { kind: 'tangent', dashed: true, label }));
  }
  if (edges.length) useBoards.getState().addEdges(edges);
  return edges.length;
}
