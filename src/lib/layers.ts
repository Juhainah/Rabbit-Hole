import { currentBoard, useBoards } from '../store/boards';
import type { ClueNode } from '../types';
import { sizeOf } from './factory';

// What is drawn on top of what, like layers in a design tool. The board paints cards by their layer
// number, then by their place in the list; frames always stay underneath the cards.

export type LayerMove = 'front' | 'forward' | 'backward' | 'back';

const z = (n: ClueNode) => n.zIndex ?? 0;
const isFrame = (n: ClueNode) => n.type === 'frame';

function overlaps(a: ClueNode, b: ClueNode) {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  return a.position.x < b.position.x + sb.w && b.position.x < a.position.x + sa.w && a.position.y < b.position.y + sb.h && b.position.y < a.position.y + sa.h;
}

/** Moves a card a step past what it overlaps, or all the way to the front or back. Returns what happened. */
export function moveLayer(id: string, move: LayerMove): string {
  const nodes = currentBoard().nodes;
  const i = nodes.findIndex((n) => n.id === id);
  const node = nodes[i];
  if (!node) return '';
  // A frame moves among frames; a card among cards (and the case files above them).
  const peers = nodes.filter((n) => n.id !== id && isFrame(n) === isFrame(node));
  const near = peers.filter((n) => overlaps(n, node));
  // Paint order: layer number, then place in the list.
  const rank = (n: ClueNode) => [z(n), nodes.indexOf(n)] as const;
  const above = (a: ClueNode, b: ClueNode) => rank(a)[0] > rank(b)[0] || (rank(a)[0] === rank(b)[0] && rank(a)[1] > rank(b)[1]);
  const over = near.filter((n) => above(n, node)).sort((a, b) => (above(a, b) ? 1 : -1));
  const under = near.filter((n) => above(node, n)).sort((a, b) => (above(a, b) ? -1 : 1));

  let anchor: ClueNode | undefined;
  let after = true;
  if (move === 'front') anchor = [...over].pop();
  else if (move === 'forward') anchor = over[0];
  else if (move === 'backward') {
    anchor = under[0];
    after = false;
  } else {
    anchor = [...under].pop();
    after = false;
  }
  if (!anchor) return move === 'front' || move === 'forward' ? 'Already on top of what it overlaps' : 'Already underneath what it overlaps';

  useBoards.getState().snapshot(move === 'front' ? 'Brought a card to the front' : move === 'back' ? 'Sent a card to the back' : move === 'forward' ? 'Brought a card forward' : 'Sent a card backward');
  // Take the anchor's layer number and stand just after (or before) it in the list.
  // (A case file kept at 0 would float back up on reload, so one sent down sits just below the cards.)
  const layer = isFrame(node) ? Math.min(z(anchor), -10) : node.type === 'topic' && z(anchor) === 0 ? -1 : z(anchor);
  const moved: ClueNode = { ...node, zIndex: layer || undefined };
  const rest = nodes.filter((n) => n.id !== id);
  const at = rest.findIndex((n) => n.id === anchor!.id);
  rest.splice(after ? at + 1 : at, 0, moved);
  useBoards.getState().setNodeOrder(rest);
  return move === 'front' ? 'Brought to the front' : move === 'back' ? 'Sent to the back' : move === 'forward' ? 'Brought forward' : 'Sent backward';
}
