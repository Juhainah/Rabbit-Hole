import { currentBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import { makeEdge } from './factory';
import { play } from './sound';

// Tying cards together by hand: the red string you control.

const titleOf = (id: string) => currentBoard().nodes.find((n) => n.id === id)?.data.title || 'this card';

export function tiedEdge(a: string, b: string) {
  return currentBoard().edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
}

/** Ties two cards with a string (once). Returns the string's id. */
export function tie(a: string, b: string, label?: string) {
  if (a === b) return undefined;
  const existing = tiedEdge(a, b);
  if (existing) {
    useUi.getState().set({ toast: { text: `Already tied to “${titleOf(b)}”`, at: Date.now() } });
    return existing.id;
  }
  const edge = makeEdge(a, b, { kind: 'user', label });
  useBoards.getState().snapshot(`Tied “${titleOf(a)}” to “${titleOf(b)}”`);
  useBoards.getState().addEdges([edge]);
  play('string');
  useUi.getState().set({ toast: { text: `Tied to “${titleOf(b)}”. Type a label for the string, or press Enter to skip.`, at: Date.now(), undo: true }, labelEdit: edge.id, selectedEdgeId: edge.id });
  return edge.id;
}

/** Cuts one string. */
export function cut(edgeId: string) {
  useBoards.getState().removeEdge(edgeId);
  useUi.getState().set({ selectedEdgeId: undefined, toast: { text: 'String cut', at: Date.now(), undo: true } });
}

/** Cuts every string on a card. */
export function cutAll(nodeId: string) {
  const ids = currentBoard()
    .edges.filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => e.id);
  if (!ids.length) return;
  const s = useBoards.getState();
  s.snapshot(`Cut ${ids.length} string${ids.length === 1 ? '' : 's'} from “${titleOf(nodeId)}”`);
  s.onEdgesChange(ids.map((id) => ({ id, type: 'remove' as const })));
  useUi.getState().set({ toast: { text: `Cut ${ids.length} string${ids.length === 1 ? '' : 's'}`, at: Date.now(), undo: true } });
}

/** Moves one end of a string to another card, keeping the end the user chose. */
export function retie(edgeId: string, keep: string, to: string) {
  const e = currentBoard().edges.find((x) => x.id === edgeId);
  if (!e || keep === to) return;
  if (tiedEdge(keep, to)) {
    useUi.getState().set({ toast: { text: `Already tied to “${titleOf(to)}”`, at: Date.now() } });
    return;
  }
  const s = useBoards.getState();
  s.snapshot(`Moved a string to “${titleOf(to)}”`);
  s.removeEdge(e.id);
  const edge = makeEdge(keep, to, { ...e.data, kind: e.data?.kind ?? 'user' });
  s.addEdges([edge]);
  play('string');
  useUi.getState().set({ selectedEdgeId: edge.id, toast: { text: `Retied to “${titleOf(to)}”`, at: Date.now(), undo: true } });
}

/** Opens the card picker: tie a card to another, or move a string's end. */
export function openTiePicker(from: string, edgeId?: string) {
  useUi.getState().set({ tiePicker: { from, edgeId }, menu: undefined });
}
