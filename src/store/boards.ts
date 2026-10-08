import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { del, get, set as idbSet } from 'idb-keyval';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { Board, ChatEntry, ClueData, ClueNode, StringData, StringEdge, TimelineEntry, TrailStep } from '../types';

// IndexedDB storage. Both the JSON serialisation and the write are debounced, so
// dragging a card or streaming a dig doesn't serialise every board on every frame.
type Saved = StorageValue<Pick<BoardsState, 'boards' | 'order' | 'currentId'>>;
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const idbStorage: PersistStorage<Pick<BoardsState, 'boards' | 'order' | 'currentId'>> = {
  getItem: async (name) => {
    const raw = await get<string>(name);
    return raw ? (JSON.parse(raw) as Saved) : null;
  },
  setItem: (name, value) => {
    clearTimeout(pending.get(name));
    pending.set(
      name,
      setTimeout(() => void idbSet(name, JSON.stringify(value)), 600),
    );
  },
  removeItem: (name) => del(name),
};
window.addEventListener('pagehide', () => {
  // Flush a pending save if the tab closes mid-debounce.
  for (const [name, t] of pending) {
    clearTimeout(t);
    pending.delete(name);
    const s = useBoards.getState();
    void idbSet(name, JSON.stringify({ state: { boards: s.boards, order: s.order, currentId: s.currentId }, version: 1 }));
  }
});

const EMOJIS = ['🕳️', '🐇', '🔎', '🗝️', '🕯️', '🧿', '📼', '🛸', '🗺️', '🧬', '📜', '🦉'];

export const newBoard = (name = 'Untitled board'): Board => ({
  id: nanoid(10),
  name,
  emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  nodes: [],
  edges: [],
  timeline: [],
  trail: [],
  chat: [],
  caseCounter: 0,
});

// ── Undo ─────────────────────────────────────────────────────────────────────
// Snapshots of a board taken before anything destructive. Kept in memory only.
type Snap = Pick<Board, 'nodes' | 'edges' | 'trail' | 'timeline'> & { label: string };
const past = new Map<string, Snap[]>();
let notify: ((label: string) => void) | null = null;
/** The UI registers here to show an "Undo" toast after destructive changes. */
export const onUndoable = (fn: (label: string) => void) => {
  notify = fn;
};

interface BoardsState {
  boards: Record<string, Board>;
  order: string[];
  currentId: string;
  hydrated: boolean;

  createBoard: (name?: string) => string;
  deleteBoard: (id: string) => void;
  renameBoard: (id: string, name: string) => void;
  setEmoji: (id: string, emoji: string) => void;
  togglePinBoard: (id: string) => void;
  setCurrent: (id: string) => void;
  importBoard: (board: Board) => void;
  clearBoard: () => void;

  onNodesChange: (changes: NodeChange<ClueNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<StringEdge>[]) => void;
  onConnect: (c: Connection) => void;

  addNodes: (nodes: ClueNode[]) => void;
  addEdges: (edges: StringEdge[]) => void;
  updateNode: (id: string, patch: Partial<ClueData>) => void;
  updateNodes: (fn: (n: ClueNode) => ClueNode) => void;
  /** Puts the whole list of cards in a new order (what is drawn on top of what). */
  setNodeOrder: (nodes: ClueNode[]) => void;
  updateEdge: (id: string, patch: Partial<StringData>) => void;
  removeNodes: (ids: string[], label?: string) => void;
  /** Takes cards (and their strings) off quietly, with no undo step: for tidying the app does itself, like a dig moving extras into "More finds". */
  dropNodes: (ids: string[]) => void;
  removeEdge: (id: string) => void;

  addTimeline: (entries: TimelineEntry[]) => void;
  /** Changes one moment on the timeline, or removes it when the change is null. Undoable. */
  editTimeline: (id: string, change: Partial<TimelineEntry> | null) => void;
  addTrail: (step: TrailStep) => void;
  nextCaseNo: () => number;

  addChat: (entry: ChatEntry) => void;
  updateChat: (id: string, patch: Partial<ChatEntry> | ((e: ChatEntry) => Partial<ChatEntry>)) => void;
  clearChat: () => void;

  /** Remember the current board so the next change can be undone. */
  snapshot: (label: string) => void;
  /** Restore the last snapshot. Returns what was undone. */
  undo: () => string | undefined;
}

/** A board loaded from storage (this device or the account): anything that was mid-flight
 *  when it was saved can't still be running. */
export function settleBoard(b: Board): Board {
  // Strings left pointing at a removed card (older versions could leave them) are dropped.
  const ids = new Set((b.nodes ?? []).map((n) => n.id));
  return {
    ...b,
    // A board saved without its name (an old sync bug) still shows as a board.
    name: b.name || 'Untitled board',
    emoji: b.emoji || '🗂️',
    chat: (b.chat ?? []).map((c) =>
      c.pending ? { ...c, pending: false, error: !c.content, content: c.content || 'Interrupted before it finished. Try again.' } : c,
    ),
    nodes: (b.nodes ?? []).map((n) => {
      // Boards from older versions: case files sit above strings.
      const layered = n.type === 'topic' && !n.zIndex ? { ...n, zIndex: 2500 } : n;
      return layered.data.status === 'digging'
        ? { ...layered, data: { ...layered.data, status: 'error', statusText: 'Interrupted. Dig again to finish this case.' } }
        : layered;
    }),
    // Older boards drew strings over the cards; they now run behind.
    edges: (b.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => (e.zIndex ? { ...e, zIndex: 0 } : e)),
    timeline: b.timeline ?? [],
    trail: b.trail ?? [],
  };
}

/**
 * The board that store changes go to. Normally the open one; a dig or a chat answer that started
 * on another board runs its updates inside onBoard(id, …) so they land on its own board even
 * after you switch away.
 */
let target: string | undefined;
const targetId = (s: { currentId: string; boards: Record<string, Board> }) => (target && s.boards[target] ? target : s.currentId);
export function onBoard<T>(id: string | undefined, fn: () => T): T {
  const prev = target;
  target = id;
  try {
    return fn();
  } finally {
    target = prev;
  }
}

const first = newBoard('My first rabbit hole');

export const useBoards = create<BoardsState>()(
  persist(
    (set, get) => {
      let lastSnap = 0;
      const snap = (label: string) => {
        const b = get().boards[targetId(get())];
        if (!b) return;
        // One user action can fire several changes (a card and then its strings): keep one snapshot.
        if (Date.now() - lastSnap < 80) return;
        lastSnap = Date.now();
        const stack = past.get(b.id) ?? [];
        stack.push({ nodes: b.nodes, edges: b.edges, trail: b.trail, timeline: b.timeline, label });
        if (stack.length > 30) stack.shift();
        past.set(b.id, stack);
        notify?.(label);
      };
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

      /** Apply an update to the current board. */
      const patch = (fn: (b: Board) => Partial<Board>) =>
        set((s) => {
          const b = s.boards[targetId(s)];
          if (!b) return s;
          return { boards: { ...s.boards, [b.id]: { ...b, ...fn(b), updatedAt: Date.now() } } };
        });

      return {
        boards: { [first.id]: first },
        order: [first.id],
        currentId: first.id,
        hydrated: false,

        createBoard: (name) => {
          const b = newBoard(name);
          set((s) => ({ boards: { ...s.boards, [b.id]: b }, order: [b.id, ...s.order], currentId: b.id }));
          return b.id;
        },
        deleteBoard: (id) =>
          set((s) => {
            const boards = { ...s.boards };
            delete boards[id];
            let order = s.order.filter((x) => x !== id);
            if (!order.length) {
              const b = newBoard();
              boards[b.id] = b;
              order = [b.id];
            }
            return { boards, order, currentId: s.currentId === id ? order[0] : s.currentId };
          }),
        renameBoard: (id, name) =>
          set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], name, updatedAt: Date.now() } } } : s)),
        togglePinBoard: (id) => set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], pinned: !s.boards[id].pinned, updatedAt: Date.now() } } } : s)),
        setEmoji: (id, emoji) => set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], emoji, updatedAt: Date.now() } } } : s)),
        setCurrent: (id) => set({ currentId: id }),
        importBoard: (board) =>
          set((s) => {
            // Files from older versions drew strings over the cards; they run behind now.
            const b = { ...newBoard(), ...board, id: nanoid(10), updatedAt: Date.now(), edges: (board.edges ?? []).map((e) => (e.zIndex ? { ...e, zIndex: 0 } : e)) };
            return { boards: { ...s.boards, [b.id]: b }, order: [b.id, ...s.order], currentId: b.id };
          }),
        clearBoard: () => {
          snap('Cleared the board');
          patch(() => ({ nodes: [], edges: [], timeline: [], trail: [], caseCounter: 0 }));
        },

        onNodesChange: (changes) => {
          const gone = new Set(changes.flatMap((c) => (c.type === 'remove' ? [c.id] : [])));
          if (gone.size) snap(`Unpinned ${plural(gone.size, 'card')}`);
          patch((b) => ({
            nodes: applyNodeChanges(changes, b.nodes),
            // A card's strings go with it, or they'd point at nothing (and break the Web and Map views).
            ...(gone.size ? { edges: b.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)) } : {}),
          }));
        },
        onEdgesChange: (changes) => {
          const removed = changes.filter((c) => c.type === 'remove').length;
          // Strings removed together with their cards are covered by the card snapshot.
          if (removed && changes.length === removed && !get().boards[get().currentId]?.nodes.some((n) => n.selected)) snap(`Cut ${plural(removed, 'string')}`);
          patch((b) => ({ edges: applyEdgeChanges(changes, b.edges) }));
        },
        onConnect: (c) =>
          patch((b) => ({
            edges: addEdge<StringEdge>(
              { ...c, id: `e-${nanoid(8)}`, type: 'string', zIndex: 0, data: { kind: 'user' } },
              b.edges,
            ),
          })),

        addNodes: (nodes) => patch((b) => ({ nodes: [...b.nodes, ...nodes] })),
        addEdges: (edges) =>
          patch((b) => {
            const existing = new Set(b.edges.map((e) => `${e.source}>${e.target}`));
            const nodeIds = new Set(b.nodes.map((n) => n.id));
            const fresh = edges.filter(
              (e) =>
                e.source !== e.target &&
                nodeIds.has(e.source) &&
                nodeIds.has(e.target) &&
                !existing.has(`${e.source}>${e.target}`) &&
                !existing.has(`${e.target}>${e.source}`),
            );
            return { edges: [...b.edges, ...fresh] };
          }),
        updateNode: (id, data) =>
          patch((b) => ({ nodes: b.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)) })),
        updateNodes: (fn) => patch((b) => ({ nodes: b.nodes.map(fn) })),
        setNodeOrder: (nodes) => patch((b) => (nodes.length === b.nodes.length ? { nodes } : {})),
        updateEdge: (id, data) =>
          patch((b) => ({ edges: b.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...data } } : e)) })),
        removeNodes: (ids, label) => {
          snap(label ?? `Unpinned ${plural(ids.length, 'card')}`);
          patch((b) => ({
            nodes: b.nodes.filter((n) => !ids.includes(n.id)),
            edges: b.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
          }));
        },
        dropNodes: (ids) =>
          patch((b) => ({
            nodes: b.nodes.filter((n) => !ids.includes(n.id)),
            edges: b.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
          })),
        removeEdge: (id) => {
          snap('Cut a string');
          patch((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },
        snapshot: (label) => snap(label),
        undo: () => {
          const b = get().boards[targetId(get())];
          const s = b && past.get(b.id)?.pop();
          if (!s) return undefined;
          patch(() => ({ nodes: s.nodes, edges: s.edges, trail: s.trail, timeline: s.timeline }));
          return s.label;
        },

        addTimeline: (entries) => patch((b) => ({ timeline: [...b.timeline, ...entries] })),
        editTimeline: (id, change) => {
          snap(change ? 'Edited a moment' : 'Removed a moment');
          patch((b) => ({
            timeline: change ? b.timeline.map((t) => (t.id === id ? { ...t, ...change, id } : t)) : b.timeline.filter((t) => t.id !== id),
          }));
        },
        addTrail: (step) => patch((b) => ({ trail: [...b.trail, step] })),
        nextCaseNo: () => {
          const b = get().boards[targetId(get())];
          const n = (b?.caseCounter ?? 0) + 1;
          patch(() => ({ caseCounter: n }));
          return n;
        },

        addChat: (entry) => patch((b) => ({ chat: [...b.chat, entry] })),
        updateChat: (id, p) =>
          patch((b) => ({
            chat: b.chat.map((c) => (c.id === id ? { ...c, ...(typeof p === 'function' ? p(c) : p) } : c)),
          })),
        clearChat: () => patch(() => ({ chat: [] })),
      };
    },
    {
      name: 'rabbit-hole-boards',
      version: 1,
      storage: idbStorage,
      partialize: (s) => ({ boards: s.boards, order: s.order, currentId: s.currentId }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const boards: Record<string, Board> = {};
          for (const [id, b] of Object.entries(state.boards)) {
            // Leftovers of deleted boards (no name, nothing on them) are dropped.
            if (!b || (!b.name && !b.nodes?.length)) continue;
            boards[id] = settleBoard(b);
          }
          const order = state.order.filter((id) => boards[id]);
          for (const id of Object.keys(boards)) if (!order.includes(id)) order.push(id);
          if (!order.length) {
            const b = newBoard('My first rabbit hole');
            boards[b.id] = b;
            order.push(b.id);
          }
          useBoards.setState({ boards, order, currentId: boards[state.currentId] ? state.currentId : order[0], hydrated: true });
          return;
        }
        useBoards.setState({ hydrated: true });
      },
    },
  ),
);

export const useCurrentBoard = () => useBoards((s) => s.boards[s.currentId]);
export const currentBoard = () => {
  const s = useBoards.getState();
  return s.boards[targetId(s)];
};
