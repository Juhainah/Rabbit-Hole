import { currentBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import { startDig } from './dig';
import { startFromTemplate, TEMPLATES } from './templates';

// The home screen (Case files) starts new investigations on a fresh board of their own,
// so a new topic never lands on an old case.

/** A board to start on: the open one if it is still empty, else a new one. */
function freshBoard(name?: string) {
  const open = currentBoard();
  const s = useBoards.getState();
  if (open && open.nodes.length === 0) {
    if (name) s.renameBoard(open.id, name);
  } else {
    s.createBoard(name);
  }
  useUi.getState().set({ caseFilesOpen: false, view: 'board', selectedNodeId: undefined, selectedEdgeId: undefined, leftOpen: false, rightOpen: false });
}

/** Dig into a topic (or a link) on a new board. */
export function digNewCase(q: string) {
  const query = q.trim();
  if (!query) return;
  const isLink = /^https?:\/\//.test(query);
  freshBoard(isLink ? undefined : query.slice(0, 60));
  // Let the board view mount before the dig starts placing cards on it.
  setTimeout(() => void (isLink ? startDig({ query: '', url: query }) : startDig({ query })), 60);
}

/** A board built by hand, from a template or blank. */
export function buildNewCase(templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  freshBoard(t ? t.name : undefined);
  setTimeout(() => startFromTemplate(templateId), 250);
}
