import { nanoid } from 'nanoid';
import { sourceMeta } from '../../shared/sources';
import type { Analysis, EntityEnrichment, SourceItem } from '../../shared/types';
import { currentBoard, onBoard, useBoards } from '../store/boards';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import type { Board, ClueData, ClueNode, ClueType, MapPoint, StringEdge } from '../types';
import { api } from './api';
import { centerOf, itemToNode, makeEdge, makeNode, sizeOf, type Point } from './factory';
import { viewportCenter } from './flow';
import { clusterCenter, evidencePos, freeSpot, LEADS_OFFSET, RING, ringPos } from './layout';
import { play } from './sound';
import { nameMatcher, tokenize } from './names';
import { linkAcrossCases, weaveCase } from './weave';

const controllers = new Map<string, AbortController>();
export const stopDig = (topicId: string) => controllers.get(topicId)?.abort();
export const isDigging = (topicId: string) => controllers.has(topicId);

/** The chain of case files that led to this one, for the AI's context. */
/** The first case in a chain of deeper digs: where the investigation started. */
function rootTopic(board: Board, topic: ClueNode): ClueNode {
  let cur = topic;
  for (let guard = 0; guard < 8; guard++) {
    const inEdge = board.edges.find((e) => e.target === cur.id && e.data?.kind === 'tangent');
    const src = inEdge && board.nodes.find((n) => n.id === inEdge.source);
    const up = src && (src.type === 'topic' ? src : board.nodes.find((n) => n.type === 'topic' && n.data.clusterId === src.data.clusterId));
    if (!up || up.id === cur.id) break;
    cur = up;
  }
  return cur;
}

function ancestors(board: Board, topic?: ClueNode): string[] {
  const out: string[] = [];
  let cur = topic;
  for (let guard = 0; cur && guard < 8; guard++) {
    out.unshift(cur.data.title);
    const inEdge = board.edges.find((e) => e.target === cur!.id && e.data?.kind === 'tangent');
    if (!inEdge) break;
    const src = board.nodes.find((n) => n.id === inEdge.source);
    cur = src?.type === 'topic' ? src : board.nodes.find((n) => n.type === 'topic' && n.data.clusterId === src?.data.clusterId);
  }
  return out;
}

export const topicOf = (board: Board, node?: ClueNode) =>
  !node ? undefined : node.type === 'topic' ? node : board.nodes.find((n) => n.type === 'topic' && n.data.clusterId === node.data.clusterId);

/** Starts a dig; resolves with the new case file's id when the dig finishes. */
export async function startDig(opts: { query: string; parentId?: string; url?: string; title?: string }): Promise<string | undefined> {
  const query = opts.query.trim();
  if (!query && !opts.url) return undefined;
  const store = useBoards.getState();
  const board = currentBoard();
  // Everything this dig adds goes to this board, even if you switch to another one meanwhile.
  const boardId = board.id;
  const here = () => useBoards.getState().currentId === boardId;
  const prefs = useSettings.getState();
  const ui = useUi.getState();

  const parent = opts.parentId ? board.nodes.find((n) => n.id === opts.parentId) : undefined;
  const parentTopic = topicOf(board, parent);
  const depth = parentTopic ? (parentTopic.data.depth ?? 0) + 1 : 0;
  const trail = parentTopic ? ancestors(board, parentTopic) : [];
  // The investigation this dig belongs to, as the user first searched it ("rotten.com").
  // Tangents are new holes, not parts of the case: framing them by it made the AI invent links.
  const rootCase = parentTopic && parent?.type !== 'tangent' ? rootTopic(board, parentTopic) : undefined;
  const caseQuery = rootCase ? (rootCase.data.query ?? rootCase.data.title) : undefined;
  const center = clusterCenter(board.nodes, parent);
  const clusterId = nanoid(8);
  const topicId = `topic-${clusterId}`;
  const caseNo = store.nextCaseNo();
  // A fresh board takes its name from its first dig.
  if (!board.nodes.length && /^(Untitled (board|hole)|My first rabbit hole)$/.test(board.name)) store.renameBoard(board.id, (query || opts.url!).slice(0, 48));

  store.addNodes([
    makeNode('topic', center, { title: opts.title || query || opts.url!, query: query || undefined, status: 'digging', statusText: 'Opening case file…', depth, clusterId, caseNo, url: opts.url }, topicId),
  ]);
  if (parent) {
    store.addEdges([makeEdge(parent.id, topicId, { kind: 'tangent', dashed: true, label: depth > 2 ? 'deeper…' : 'down the hole' })]);
    if (parent.type === 'tangent') store.updateNode(parent.id, { explored: true });
  }
  store.addTrail({ nodeId: topicId, title: opts.title || query || opts.url!, depth, at: Date.now() });
  ui.focusNodes([topicId]);
  ui.set({ digging: ui.digging + 1 });
  ui.log(`⛏ Digging into “${query || opts.url}”`, 'info');
  play('dig');

  const ctrl = new AbortController();
  controllers.set(topicId, ctrl);
  const seenUrls = new Set(board.nodes.map((n) => n.data.url).filter(Boolean) as string[]);
  const newIds: string[] = [topicId];
  const innerIds: string[] = [topicId];
  const itemNodes = new Map<string, string>();
  const itemsById = new Map<string, SourceItem>();
  let photosLeft = 6;
  let mediaLeft = 3;
  const entityIds = new Map<string, string>();
  /** The who's-who gallery and the card it belongs to ("Boyfriends" → "Star Chat"). */
  const galleries: { id: string; about?: string; title: string }[] = [];
  const geo: MapPoint[] = [];
  let evIndex = 0;
  let primaryTitle: string | undefined;

  const setStatus = (statusText: string) => useBoards.getState().updateNode(topicId, { statusText });

  // Pull the camera back as clues land so you watch the board fill up.
  let lastFrame = 0;
  const reframe = () => {
    if (!here() || Date.now() - lastFrame < 2200) return;
    lastFrame = Date.now();
    useUi.getState().focusNodes([...newIds]);
  };

  const addEvidence = (items: SourceItem[], max = prefs.perSource) => {
    const nodes: ClueNode[] = [];
    const edges: StringEdge[] = [];
    for (const it of items.slice(0, max)) {
      if (it.url && seenUrls.has(it.url)) continue;
      if (it.source === 'wikipedia' && it.title === primaryTitle) continue;
      if (it.url) seenUrls.add(it.url);
      const node = itemToNode(it, evidencePos(center, evIndex++), { clusterId, vetting: true });
      itemNodes.set(it.id, node.id);
      itemsById.set(it.id, it);
      nodes.push(node);
      edges.push(makeEdge(topicId, node.id, { kind: 'evidence' }, 'pin', true));
      if (it.lat != null && it.lon != null) geo.push({ lat: it.lat, lon: it.lon, label: it.title.slice(0, 26), nodeId: node.id, from: 'evidence' });
    }
    if (!nodes.length) return;
    useBoards.getState().addNodes(nodes);
    useBoards.getState().addEdges(edges);
    newIds.push(...nodes.map((n) => n.id));
    play('pin');
    reframe();
  };

  const applyAnalysis = (a: Analysis) => {
    const s = useBoards.getState();
    s.updateNode(topicId, { title: a.title || query, hook: a.hook, text: a.summary, premise: a.premise, statusText: 'Mapping connections…' });
    if (a.premise) useUi.getState().log(`⚠ ${a.premise}`, 'warn');

    const nodes: ClueNode[] = [];
    const edges: StringEdge[] = [];
    a.entities.forEach((e, i) => {
      const n = makeNode('entity', ringPos(center, RING.entity, i, a.entities.length), {
        title: e.name,
        text: e.description,
        entityType: e.type,
        date: e.date,
        clusterId,
        query: e.name,
        meta: e.place ? { place: e.place } : undefined,
      });
      entityIds.set(e.name.toLowerCase(), n.id);
      nodes.push(n);
    });
    const idFor = (name: string) => (name === 'TOPIC' ? topicId : entityIds.get(name.toLowerCase()));
    // Key evidence, strung to the card it is evidence for, labelled with what it shows.
    for (const c of a.cites ?? []) {
      const ev = itemNodes.get(c.item);
      const to = idFor(c.entity);
      if (ev && to && ev !== to) edges.push(makeEdge(to, ev, { kind: 'evidence', label: c.label }));
    }
    const linked = new Set<string>();
    for (const r of a.relations) {
      const from = idFor(r.from);
      const to = idFor(r.to);
      if (!from || !to) continue;
      edges.push(makeEdge(from, to, { kind: 'relation', label: r.label }, 'pin', from === topicId || to === topicId));
      linked.add(from).add(to);
    }
    for (const n of nodes) if (!linked.has(n.id)) edges.push(makeEdge(topicId, n.id, { kind: 'relation' }, 'pin', true));
    // The who's-who gallery hangs off the card it belongs to, not just the case.
    for (const gallery of galleries) {
      if (!gallery.about) continue;
      const about = tokenize(gallery.about);
      const owner = nodes.find((n) => nameMatcher(n.data.title)(about) || nameMatcher(gallery.about!)(tokenize(n.data.title)));
      if (owner) edges.push(makeEdge(owner.id, gallery.id, { kind: 'evidence', label: `the ${gallery.title.replace(/\s*\(.*\)\s*$/, '').toLowerCase()}` }));
    }

    // Rabbit holes and open questions share the ring just outside the index cards.
    const leads = a.tangents.length + a.questions.length;
    a.tangents.forEach((t, i) => {
      const n = makeNode('tangent', ringPos(center, RING.leads, i, leads, LEADS_OFFSET), {
        title: t.title,
        hook: t.hook,
        query: t.query,
        clusterId,
      });
      nodes.push(n);
      edges.push(makeEdge(topicId, n.id, { kind: 'tangent', dashed: true }, 'pin', true));
    });
    a.questions.forEach((q, i) => {
      const n = makeNode('question', ringPos(center, RING.leads, a.tangents.length + i, leads, LEADS_OFFSET), { title: q, clusterId, query: q });
      nodes.push(n);
      edges.push(makeEdge(topicId, n.id, { kind: 'evidence' }, 'pin', true));
    });

    s.addNodes(nodes);
    s.addEdges(edges);
    s.addTimeline(a.timeline.map((t) => ({ id: nanoid(6), date: t.date, event: t.event, clusterId, nodeId: t.item ? itemNodes.get(t.item) : undefined })));
    newIds.push(...nodes.map((n) => n.id));
    innerIds.push(...nodes.map((n) => n.id));
    ui.log(`🧵 Strung together ${a.entities.length} clues and ${a.tangents.length} new rabbit holes`, 'ok');
    play('string');
  };

  const applyEnrich = (found: Record<string, EntityEnrichment>) => {
    const s = useBoards.getState();
    for (const [name, e] of Object.entries(found)) {
      const id = entityIds.get(name.toLowerCase());
      if (!id) continue;
      const node = currentBoard().nodes.find((n) => n.id === id);
      const patch: Partial<ClueData> = { image: e.image, url: e.url, lat: e.lat, lon: e.lon, source: e.url ? 'wikipedia' : undefined };
      if (!node?.data.text && e.extract) patch.text = e.extract;
      s.updateNode(id, patch);
      if (e.lat != null && e.lon != null) geo.push({ lat: e.lat, lon: e.lon, label: name.slice(0, 26), nodeId: id, from: 'entity' });
    }
    addMap();
  };

  const addMap = () => {
    // Only points whose card is still on the board (off-topic results get taken off).
    const alive = new Set(currentBoard().nodes.map((n) => n.id));
    const points = geo.filter((p) => !p.nodeId || alive.has(p.nodeId)).filter(
      (p, i, arr) => arr.findIndex((q) => Math.abs(q.lat - p.lat) < 0.01 && Math.abs(q.lon - p.lon) < 0.01) === i,
    ).slice(0, 12);
    // A map needs a geographic reason: the case's article or one of its cards has a place, or several finds do.
    // A game, an app or a song gets none for one search result that happens to have coordinates.
    if (!points.length || (!points.some((p) => p.from !== 'evidence') && points.length < 3)) return;
    const mapNode = makeNode('map', { x: center.x, y: center.y - RING.map }, { title: `Map: ${primaryTitle ?? query}`, points, clusterId });
    const s = useBoards.getState();
    s.addNodes([mapNode]);
    s.addEdges(
      points
        .map((p, i) => (p.nodeId && p.nodeId !== topicId ? makeEdge(p.nodeId, mapNode.id, { kind: 'relation' }, `pt-${i}`) : null))
        .filter((e): e is StringEdge => !!e),
    );
    newIds.push(mapNode.id);
    ui.log(`🗺 Pinned ${points.length} location${points.length === 1 ? '' : 's'} on a map`, 'ok');
  };

  try {
    await api.dig(
      { topic: query, url: opts.url, trail, caseQuery, sources: prefs.digSources, perSource: prefs.perSource },
      (ev) => onBoard(boardId, () => {
        const log = useUi.getState().log;
        switch (ev.type) {
          case 'status':
            setStatus(ev.message);
            log(ev.message, ev.level === 'warn' ? 'warn' : 'info');
            break;
          case 'source':
            log(`${sourceMeta(ev.source).name}: ${ev.items.length ? `${ev.items.length} found` : 'nothing'}`, ev.items.length ? 'ok' : 'info', ev.source);
            addEvidence(ev.items, ev.limit);
            break;
          case 'source-error':
            log(`${sourceMeta(ev.source).name}: ${ev.error}`, 'warn', ev.source);
            break;
          case 'primary': {
            const p = ev.primary;
            primaryTitle = p.title;
            useBoards.getState().updateNode(topicId, {
              image: p.image,
              url: p.url ?? opts.url,
              text: p.extract.slice(0, 700).replace(/\s+\S*$/, '…'),
              source: p.source,
              lat: p.lat,
              lon: p.lon,
            });
            if (p.lat != null && p.lon != null) geo.unshift({ lat: p.lat, lon: p.lon, label: p.title.slice(0, 26), nodeId: topicId, mark: 'x', from: 'primary' });
            break;
          }
          case 'analysis':
            applyAnalysis(ev.analysis);
            break;
          case 'enrich':
            applyEnrich(ev.entities);
            break;
          case 'photos':
            addEvidence(ev.items, photosLeft);
            photosLeft = Math.max(0, photosLeft - ev.items.length);
            log(`📷 Pinned photos from the archives`, 'ok', 'commons');
            break;
          case 'media': {
            addEvidence(ev.items, mediaLeft);
            mediaLeft = Math.max(0, mediaLeft - ev.items.length);
            const audio = ev.items.filter((i) => i.kind === 'audio').length;
            const films = ev.items.length - audio;
            log(`🎙 Found ${[audio && `${audio} recording${audio === 1 ? '' : 's'}`, films && `${films} film${films === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}`, 'ok', 'archive');
            break;
          }
          case 'thumbs': {
            const s = useBoards.getState();
            const nodes = currentBoard().nodes;
            for (const [itemId, image] of Object.entries(ev.images)) {
              const id = itemNodes.get(itemId);
              if (id && !nodes.find((n) => n.id === id)?.data.image) s.updateNode(id, { image });
            }
            break;
          }
          case 'gallery': {
            const g = ev.gallery;
            const card = makeNode('gallery', evidencePos(center, evIndex++), {
              title: g.title,
              url: g.url,
              source: g.source,
              clusterId,
              items: g.items.map((p) => ({ title: p.title, image: p.image, url: p.url, role: p.meta?.role ? String(p.meta.role) : undefined })),
              text: g.note,
              listLabel: g.label,
            });
            useBoards.getState().addNodes([card]);
            useBoards.getState().addEdges([makeEdge(topicId, card.id, { kind: 'evidence' }, 'pin', true)]);
            newIds.push(card.id);
            galleries.push({ id: card.id, about: g.about, title: g.title });
            log(`🗂 ${g.label ?? "Who's who"}: ${g.items.length} from ${g.title}`, 'ok', g.source);
            break;
          }
          case 'extras': {
            // Good but not essential: off the board, into the case file's "More finds".
            const moved = ev.ids.map((i) => itemsById.get(i)).filter((it): it is SourceItem => !!it);
            const nodeIds = ev.ids.map((i) => itemNodes.get(i)).filter((id): id is string => !!id);
            if (nodeIds.length) {
              const s = useBoards.getState();
              const topic = currentBoard().nodes.find((n) => n.id === topicId);
              s.updateNode(topicId, { extras: [...(topic?.data.extras ?? []), ...moved] });
              s.dropNodes(nodeIds);
              // The AI has picked the board: what stays is vetted.
              s.updateNodes((n) => (n.data.vetting && n.data.clusterId === clusterId ? { ...n, data: { ...n.data, vetting: undefined } } : n));
              log(`🗂 Kept the board to the key evidence; ${nodeIds.length} more finds are in the case file`, 'ok');
            }
            break;
          }
          case 'prune': {
            const ids = ev.ids.map((i) => itemNodes.get(i)).filter((id): id is string => !!id);
            if (ids.length) {
              useBoards.getState().dropNodes(ids);
              log(`🗑 Tossed ${ids.length} off-topic clipping${ids.length === 1 ? '' : 's'}`, 'info');
            }
            break;
          }
          case 'error':
            setStatus(ev.message);
            log(ev.message, 'err');
            if (!entityIds.size) addMap();
            break;
        }
      }),
      ctrl.signal,
    );
    onBoard(boardId, () => {
      useBoards.getState().updateNode(topicId, { status: 'done', statusText: undefined });
      // Weave the evidence in: string clues to the cards they mention and seat them alongside.
      const woven = weaveCase(clusterId, topicId);
      if (woven) useUi.getState().log(`🧶 Wove ${woven} clue${woven === 1 ? '' : 's'} to the people and places they mention`, 'ok');
      // After enrichment, cards carry Wikipedia links, so twins in other cases match reliably.
      const shared = linkAcrossCases(clusterId);
      if (shared) useUi.getState().log(`🔗 ${shared} card${shared === 1 ? '' : 's'} also appear in earlier cases`, 'ok');
    });
    if (here()) play('found');
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    const message = aborted ? 'Stopped' : e instanceof Error ? e.message : String(e);
    onBoard(boardId, () => useBoards.getState().updateNode(topicId, { status: aborted ? 'done' : 'error', statusText: message }));
    if (!aborted) useUi.getState().log(message, 'err');
  } finally {
    controllers.delete(topicId);
    // What's left has been vetted (or the dig stopped): no card stays marked "checking".
    onBoard(boardId, () => useBoards.getState().updateNodes((n) => (n.data.vetting && n.data.clusterId === clusterId ? { ...n, data: { ...n.data, vetting: undefined } } : n)));
    const u = useUi.getState();
    u.set({ digging: Math.max(0, u.digging - 1) });
    // End on the heart of the case (file, people, leads) at a readable zoom, if you are still looking at it.
    if (here()) {
      const alive = new Set(currentBoard().nodes.map((n) => n.id));
      u.focusNodes(innerIds.filter((id) => alive.has(id)));
    }
  }
  return topicId;
}

/** The case file a rabbit-hole card led to, if it has been explored. */
export function caseFromTangent(tangentId: string) {
  const board = currentBoard();
  const edge = board.edges.find((e) => e.source === tangentId && e.data?.kind === 'tangent' && board.nodes.find((n) => n.id === e.target)?.type === 'topic');
  return edge?.target;
}

/** Keep falling: dig the next unexplored rabbit hole, `steps` times in a row. */
export async function autoFall(fromTopicId: string, steps = 3) {
  let topicId: string | undefined = fromTopicId;
  const ui = useUi.getState();
  ui.log(`🕳 Falling ${steps} holes deep…`, 'info');
  for (let i = 0; i < steps && topicId; i++) {
    const board = currentBoard();
    const topic = board.nodes.find((n) => n.id === topicId);
    if (!topic || topic.data.statusText === 'Stopped') break;
    const leads = board.nodes.filter((n) => n.type === 'tangent' && n.data.clusterId === topic.data.clusterId && !n.data.explored);
    if (!leads.length) {
      ui.log('No unexplored rabbit holes left here', 'warn');
      break;
    }
    // Not always the first lead: a little randomness makes every fall different.
    const next = leads[Math.floor(Math.random() * Math.min(3, leads.length))];
    topicId = await startDig({ query: next.data.query ?? next.data.title, title: next.data.title, parentId: next.id });
  }
}

/** Where a manually added clue should land. */
/** Moves a new card to the nearest open space by the card it belongs with (or the middle of the view). */
function settle(node: ClueNode, nearId?: string) {
  const board = currentBoard();
  const near = nearId ? board.nodes.find((n) => n.id === nearId) : undefined;
  const s = sizeOf(node);
  const c = freeSpot(board.nodes, near ? centerOf(near) : viewportCenter(), s);
  node.position = { x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2) };
}

/** A string label short enough to read on the board, cut at a word. */
export function shortLabel(label?: string) {
  const t = label?.trim().replace(/[."“”]+$/, '');
  if (!t) return undefined;
  if (t.length <= 34) return t;
  return t.slice(0, 34).replace(/\s+\S*$/, '') + '…';
}

export function pinItem(item: SourceItem, opts: { near?: string; at?: Point; label?: string } = {}) {
  const board = currentBoard();
  // Already on the board? Fly to it rather than pinning a duplicate.
  const existing = item.url ? board.nodes.find((n) => n.data.url === item.url) : undefined;
  if (existing) {
    useUi.getState().select(existing.id);
    useUi.getState().focusNodes([existing.id]);
    return existing.id;
  }
  const near = opts.near ? board.nodes.find((n) => n.id === opts.near) : undefined;
  const node = itemToNode(item, opts.at ?? { x: 0, y: 0 }, { clusterId: near?.data.clusterId });
  if (!opts.at) settle(node, opts.near);
  const s = useBoards.getState();
  s.addNodes([node]);
  if (near) s.addEdges([makeEdge(near.id, node.id, { kind: 'evidence', label: shortLabel(opts.label) })]);
  play('pin');
  useUi.getState().select(node.id);
  return node.id;
}

const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;

/** Drop or paste any link: images become polaroids, pages become clippings (read by the server). */
export function pinUrl(url: string, opts: { near?: string; at?: Point } = {}) {
  if (IMAGE_URL.test(url)) return addClue('image', { title: domainTitle(url), image: url, url }, opts);
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
  if (yt) {
    return addClue('video', { title: 'YouTube video', url, image: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, media: { type: 'youtube', src: yt }, source: 'youtube' }, opts);
  }
  const id = addClue('clip', { title: domainTitle(url), url, text: 'Reading the page…' }, opts);
  api
    .scrape(url)
    .then((page) =>
      useBoards.getState().updateNode(id, {
        title: page.title,
        text: page.excerpt || page.text.slice(0, 400),
        image: page.image,
        author: page.byline || page.siteName,
        date: page.published?.slice(0, 10),
        source: page.via === 'wayback' ? 'wayback' : undefined,
        meta: page.via === 'wayback' ? { archived: page.archivedAt ?? '' } : undefined,
      }),
    )
    .catch((e) => useBoards.getState().updateNode(id, { text: `Couldn't read it: ${e instanceof Error ? e.message : e}` }));
  return id;
}

function domainTitle(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 60);
  }
}

/** Adds a card. `near` places it beside another card; `tie` also strings them together. */
export function addClue(type: ClueType, data: Partial<ClueData> = {}, opts: { near?: string; at?: Point; tie?: boolean } = {}) {
  const board = currentBoard();
  const near = opts.near ? board.nodes.find((n) => n.id === opts.near) : undefined;
  const node = makeNode(type, opts.at ?? { x: 0, y: 0 }, { title: '', ...data, clusterId: data.clusterId ?? near?.data.clusterId });
  if (!opts.at) settle(node, opts.near);
  const s = useBoards.getState();
  s.addNodes([node]);
  if (near && opts.tie) s.addEdges([makeEdge(near.id, node.id, { kind: 'user' })]);
  play(type === 'note' || type === 'label' ? 'paper' : 'pin');
  useUi.getState().select(node.id);
  return node.id;
}

/** The case a card belongs to, named the way the user searched it. */
export function caseName(node?: ClueNode) {
  const topic = topicOf(currentBoard(), node);
  return topic ? (topic.data.query ?? topic.data.title) : undefined;
}

/**
 * Opens the partner on a card, always framed by its case: asking about
 * "Buenos Aires" on a Liam Payne board means Buenos Aires *in that story*.
 */
export function askAbout(nodeId: string) {
  const node = currentBoard().nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const ui = useUi.getState();
  ui.select(nodeId);
  const topicName = caseName(node);
  const title = node.data.title;
  let text: string;
  if (node.type === 'topic') text = `What actually happened in "${title}"? Give me the key facts in order, then the most interesting open question.`;
  else if (node.type === 'question') text = topicName ? `${title} (in the case of ${topicName})` : title;
  else if (node.type === 'image' || node.type === 'video')
    text = `What does ${node.type === 'image' ? 'this picture' : 'this recording'} show, and where does it come from?${node.data.date ? ` It was saved ${node.data.date}.` : ''}${topicName ? ` What does it add to ${topicName}?` : ''}`;
  else if (['clip', 'post', 'quote'].includes(String(node.type)))
    text = topicName ? `What does "${title}" tell us about ${topicName}? Pull out the key facts, names and dates it adds.` : `What are the key facts in "${title}"?`;
  else if (topicName && topicName.toLowerCase() !== title.toLowerCase()) text = `What is "${title}"'s part in ${topicName}? What do the sources say about it?`;
  else text = `What's the story behind "${title}"?`;
  // Your own photos, files and private items: the partner helps you work with them, without the web.
  const own = node.data.source === 'mine';
  if (own) {
    const what = node.type === 'image' ? 'a photo I added' : node.type === 'clip' ? 'a document I added' : 'something I added';
    text = `Help me with my own card "${title}" (${what}). Using only what is on this board, what do we know about it, how might it connect to my other cards, and what should I find out or add next?`;
  }
  ui.set({ chatPrefill: { text, at: Date.now(), offline: own, readOnly: true } });
  ui.openTab('ai');
}
