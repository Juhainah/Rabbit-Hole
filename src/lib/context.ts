import { SOURCES } from '../../shared/sources';
import type { ScrapeResult } from '../../shared/types';
import { currentBoard } from '../store/boards';
import { useUi } from '../store/ui';
import type { ClueType } from '../types';
import { TYPE_LABEL } from './utils';

const SOURCE = new Map(SOURCES.map((s) => [s.id, s]));
const archiveOf = (id?: string) => (id ? (SOURCE.get(id)?.name ?? id) : undefined);

/** Pages opened in the reader, so the AI partner can read along. */
export const readerCache = new Map<string, ScrapeResult | { title: string; text: string }>();

/** A compact description of what the user is looking at, for the AI partner. */
export function boardContext(): string {
  const board = currentBoard();
  const ui = useUi.getState();
  const lines: string[] = [`Board "${board.name}" with ${board.nodes.length} clues.`];

  const topics = board.nodes.filter((n) => n.type === 'topic');
  if (topics.length) {
    lines.push('\nCASE FILES (in the order they were dug):');
    for (const t of topics) lines.push(`- ${t.data.title}${t.data.depth ? ` (depth ${t.data.depth})` : ''}: ${(t.data.text ?? '').slice(0, 280)}`);
  }
  // Every card title, so the partner can link them as [[title]].
  const cards = board.nodes.filter((n) => n.data.title && n.type !== 'label').slice(0, 160);
  if (cards.length) {
    lines.push('\nCARDS ON THE BOARD, each with the archive it came from (link any you mention as [[exact title]]):');
    for (const n of cards) {
      const own = n.data.source === 'mine';
      const from = own ? 'added by the user (their own, not from the web)' : archiveOf(n.data.source);
      lines.push(`- [${TYPE_LABEL[n.type as ClueType]}${from ? ` · ${from}` : ''}] ${n.data.title.slice(0, 90)}${n.data.date ? ` (${n.data.date})` : ''}${own && n.data.text ? `: ${n.data.text.slice(0, 160)}` : ''}`);
    }
    // Grouped by archive, so "is anything from the Smithsonian / data.gov here?" gets an exact answer.
    const byArchive = new Map<string, string[]>();
    for (const n of cards) if (n.data.source) byArchive.set(n.data.source, [...(byArchive.get(n.data.source) ?? []), n.data.title.slice(0, 60)]);
    lines.push("\nWHERE THE CARDS CAME FROM (cards with no archive are the partner's own analysis or the user's notes):");
    for (const [id, titles] of [...byArchive].sort((a, b) => b[1].length - a[1].length)) {
      const aka = SOURCE.get(id)?.aka;
      lines.push(`- ${archiveOf(id)}${aka ? ` (${aka})` : ''}: ${titles.length} card${titles.length === 1 ? '' : 's'}: ${titles.slice(0, 8).join('; ')}${titles.length > 8 ? '; …' : ''}`);
    }
  }

  const sel = board.nodes.find((n) => n.id === ui.selectedNodeId);
  if (sel) {
    lines.push(`\nTHE USER HAS SELECTED THIS ${TYPE_LABEL[sel.type as ClueType].toUpperCase()}: "${sel.data.title}"`);
    const topic = board.nodes.find((n) => n.type === 'topic' && n.data.clusterId === sel.data.clusterId && n.id !== sel.id);
    if (topic) {
      lines.push(`It belongs to the case "${topic.data.title}" (the user searched: ${topic.data.query ?? topic.data.title}). Answer about this card IN THAT CASE.`);
    }
    if (sel.data.source === 'mine') {
      lines.push(`This is the user's OWN card: they added it themselves (${sel.type === 'image' ? 'a photo from their device' : 'their own material'}). It is not from the web and not a public topic. Do not identify it with anything online or search the web for it unless the user asks.${sel.data.image ? ' What its picture shows is described further down when it could be looked at.' : ''}`);
    }
    // Your own documents are read in full (a PDF's text, your notes); other cards in brief.
    if (sel.data.text) lines.push(sel.data.text.slice(0, sel.data.source === 'mine' ? 6000 : 1500));
    // A map card: its places, and which ones the user added by hand (those may be unrelated to the case).
    if (sel.data.points?.length) {
      const own = sel.data.points.filter((p) => p.from === 'mine').map((p) => p.label);
      const found = sel.data.points.filter((p) => p.from !== 'mine').map((p) => p.label);
      if (found.length) lines.push(`Places the case's sources put on this map: ${found.join('; ')}`);
      if (own.length) lines.push(`Places the USER added to this map by hand (no source ties them to the case): ${own.join('; ')}`);
    }
    if (sel.data.date) lines.push(`Date: ${sel.data.date}`);
    if (sel.data.url) lines.push(`Source: ${sel.data.url}`);
    const links = board.edges
      .filter((e) => e.source === sel.id || e.target === sel.id)
      .map((e) => {
        const other = board.nodes.find((n) => n.id === (e.source === sel.id ? e.target : e.source));
        return other ? `${e.data?.label ? `${e.data.label} → ` : ''}${other.data.title}` : null;
      })
      .filter(Boolean);
    if (links.length) lines.push(`Connected to: ${links.slice(0, 20).join('; ')}`);
  }

  if (ui.readerUrl && ui.rightTab === 'read') {
    const page = readerCache.get(ui.readerUrl);
    if (page) lines.push(`\nTHE USER IS READING: "${page.title}" (${ui.readerUrl})\n${page.text.slice(0, 6000)}`);
  }
  return lines.join('\n');
}
