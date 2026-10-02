import { currentBoard, useBoards } from '../store/boards';
import { api } from './api';
import { caseName } from './dig';

/**
 * Fetches every member of a who's-who card's list from the wiki page it came from
 * ("Boyfriends" → all of them, not just the first ten) and adds the missing ones.
 * Returns how many the card holds now.
 */
export async function fillGallery(id: string): Promise<number> {
  const node = currentBoard().nodes.find((n) => n.id === id);
  if (!node?.data.url) throw new Error('This card has no list page to read');
  const list = await api.wikiList(node.data.url, caseName(node) ?? '');
  const now = currentBoard().nodes.find((n) => n.id === id);
  if (!now) return 0;
  const had = now.data.items ?? [];
  const known = new Set(had.map((p) => p.title.toLowerCase()));
  const items = [...had, ...list.items.filter((p) => !known.has(p.title.toLowerCase()))];
  useBoards.getState().updateNode(id, { items, listComplete: true });
  return items.length;
}
