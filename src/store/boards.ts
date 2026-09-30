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
  updateEdge: (id: string, patch: Partial<StringData>) => void;
  removeNodes: (ids: string[], label?: string) => void;
  removeEdge: (id: string) => void;

  addTimeline: (entries: TimelineEntry[]) => void;
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

const first = newBoard('My first rabbit hole');

export const useBoards = create<BoardsState>()(
  persist(
    (set, get) => {
      let lastSnap = 0;
      const snap = (label: string) => {
        const b = get().boards[get().currentId];
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
          const b = s.boards[s.currentId];
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
          set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], name } } } : s)),
        setEmoji: (id, emoji) => set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], emoji } } } : s)),
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
          const removed = changes.filter((c) => c.type === 'remove').length;
          if (removed) snap(`Unpinned ${plural(removed, 'card')}`);
          patch((b) => ({ nodes: applyNodeChanges(changes, b.nodes) }));
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
        updateEdge: (id, data) =>
          patch((b) => ({ edges: b.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...data } } : e)) })),
        removeNodes: (ids, label) => {
          snap(label ?? `Unpinned ${plural(ids.length, 'card')}`);
          patch((b) => ({
            nodes: b.nodes.filter((n) => !ids.includes(n.id)),
            edges: b.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
          }));
        },
        removeEdge: (id) => {
          snap('Cut a string');
          patch((b) => ({ edges: b.edges.filter((e) => e.id !== id) }));
        },
        snapshot: (label) => snap(label),
        undo: () => {
          const b = get().boards[get().currentId];
          const s = b && past.get(b.id)?.pop();
          if (!s) return undefined;
          patch(() => ({ nodes: s.nodes, edges: s.edges, trail: s.trail, timeline: s.timeline }));
          return s.label;
        },

        addTimeline: (entries) => patch((b) => ({ timeline: [...b.timeline, ...entries] })),
        addTrail: (step) => patch((b) => ({ trail: [...b.trail, step] })),
        nextCaseNo: () => {
          const b = get().boards[get().currentId];
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
        // Anything that was mid-flight when the page closed can't still be running.
        if (state) {
          const boards: Record<string, Board> = {};
          for (const [id, b] of Object.entries(state.boards)) {
            boards[id] = {
              ...b,
              chat: b.chat.map((c) =>
                c.pending ? { ...c, pending: false, error: !c.content, content: c.content || 'Interrupted before it finished. Try again.' } : c,
              ),
              nodes: b.nodes.map((n) => {
                // Boards from older versions: case files sit above strings.
                const layered = n.type === 'topic' && !n.zIndex ? { ...n, zIndex: 2500 } : n;
                return layered.data.status === 'digging'
                  ? { ...layered, data: { ...layered.data, status: 'error', statusText: 'Interrupted. Dig again to finish this case.' } }
                  : layered;
              }),
              // Older boards drew strings over the cards; they now run behind.
              edges: b.edges.map((e) => (e.zIndex ? { ...e, zIndex: 0 } : e)),
            };
          }
          useBoards.setState({ boards, hydrated: true });
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
  return s.boards[s.currentId];
};
