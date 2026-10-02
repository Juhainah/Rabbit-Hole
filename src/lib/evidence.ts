import type { EntityType } from '../../shared/types';
import { currentBoard, useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import type { ClueData } from '../types';
import { api } from './api';
import { addClue, pinItem, pinUrl, topicOf } from './dig';
import { tokenize } from './names';
import type { Point } from './factory';

// Your own evidence: photos from your device, PDFs, pasted text and links, and cards
// for people, places and things you name yourself (filled in from Wikipedia).

type Opts = { near?: string; at?: Point };

/** Shrinks a photo so a board full of them still saves quickly (longest side 1400px, JPEG). */
async function shrink(file: File, max = 1400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('That file is not a picture this browser can open.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    // Keep transparency for PNGs; everything else becomes a compact JPEG.
    return file.type === 'image/png' && file.size < 400_000 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80) || 'Untitled';

/** A photo from your device becomes a polaroid. */
export async function addPhotoFile(file: File, opts: Opts = {}) {
  const image = await shrink(file);
  return addClue('image', { title: baseName(file.name), image, source: 'mine', date: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10) }, opts);
}

/** A PDF becomes a document card holding its text (read in your browser; the file isn't uploaded). */
export async function addPdfFile(file: File, opts: Opts = {}) {
  const id = addClue('clip', { title: baseName(file.name), text: 'Reading the PDF…', source: 'mine', meta: { file: 'PDF' } }, opts);
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
      if (pages.join(' ').length > 20000) break;
    }
    const text = pages.join('\n\n').trim();
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    useBoards.getState().updateNode(id, {
      title: info.Title?.trim() || baseName(file.name),
      author: info.Author?.trim() || undefined,
      text: text ? text.slice(0, 6000) : 'This PDF has no text layer (it is probably a scan).',
      meta: { file: 'PDF', pages: doc.numPages },
    });
  } catch (e) {
    useBoards.getState().updateNode(id, { text: `Couldn't read this PDF: ${e instanceof Error ? e.message : e}` });
  }
  return id;
}

/** A text file's contents as a clipping. */
async function addTextFile(file: File, opts: Opts) {
  const text = (await file.text()).slice(0, 8000);
  return addClue('clip', { title: baseName(file.name), text, source: 'mine', meta: { file: file.name.split('.').pop()?.toUpperCase() ?? 'TEXT' } }, opts);
}

/** Dropped or pasted files, side by side. */
export async function addFiles(files: File[], opts: Opts = {}) {
  const at = opts.at;
  let i = 0;
  for (const file of files.slice(0, 12)) {
    const spot = at ? { x: at.x + (i % 4) * 260, y: at.y + Math.floor(i / 4) * 320 } : undefined;
    i++;
    try {
      if (file.type.startsWith('image/')) await addPhotoFile(file, { ...opts, at: spot });
      else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) await addPdfFile(file, { ...opts, at: spot });
      else if (file.type.startsWith('text/') || /\.(txt|md|csv|json)$/i.test(file.name)) await addTextFile(file, { ...opts, at: spot });
      else useUi.getState().log(`Can't pin “${file.name}” yet: photos, PDFs and text files work.`, 'warn');
    } catch (e) {
      useUi.getState().log(e instanceof Error ? e.message : String(e), 'warn');
    }
  }
}

/** Anything pasted onto the board: pictures, links, or text. Returns true if it took it. */
export async function addPasted(data: DataTransfer, opts: Opts = {}): Promise<boolean> {
  const files = [...data.files];
  if (files.length) {
    await addFiles(files, opts);
    return true;
  }
  const text = data.getData('text/plain').trim();
  if (!text) return false;
  if (/^https?:\/\/\S+$/.test(text)) {
    pinUrl(text, opts);
    return true;
  }
  // A short line is a note; a long passage is a clipping you can read.
  if (text.length < 180) addClue('note', { text, title: text.slice(0, 60), color: '#f7de6b' }, opts);
  else addClue('clip', { title: text.split(/\n/)[0].slice(0, 80), text: text.slice(0, 8000), source: 'mine' }, opts);
  return true;
}

/** "Indian writer" → person, "2014 film" → work: what kind of card a Wikipedia description makes. */
export function kindFrom(description: string): EntityType | undefined {
  const d = description.toLowerCase();
  if (/\b(actor|actress|writer|author|poet|director|singer|musician|politician|player|journalist|businessman|businesswoman|scientist|activist|filmmaker|producer|novelist|artist|rapper|hijacker|terrorist|youtuber|personality|born \d)/.test(d)) return 'person';
  if (/\b(film|novel|short story|story|book|album|song|single|series|video game|game|play|poem|painting|documentary|magazine|newspaper|website|app)\b/.test(d)) return 'work';
  if (/\b(city|town|village|district|country|state|province|region|river|mountain|island|building|airport|neighbourhood|neighborhood)\b/.test(d)) return 'place';
  if (/\b(company|corporation|organi[sz]ation|band|group|party|agency|studio|publisher|network|university|team|airline)\b/.test(d)) return 'org';
  if (/\b(attack|war|battle|incident|disaster|crash|scandal|festival|election|protest|massacre)\b/.test(d)) return 'event';
  return undefined;
}

/**
 * Fills a card from Wikipedia: picture, one-line description, link, and what kind of thing it is.
 * A one-word name ("Angela") could be anyone, so then the page must mention the card's case.
 */
export async function fillFromWikipedia(nodeId: string, title: string) {
  const board = currentBoard();
  const node = board.nodes.find((n) => n.id === nodeId);
  const topic = topicOf(board, node);
  const caseWords = tokenize(`${topic?.data.query ?? ''} ${topic?.data.title ?? ''}`).filter((w) => w.length >= 4 || /\d/.test(w));
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
    if (!r.ok) return false;
    const p = await r.json();
    if (p.type === 'disambiguation') return false;
    const about = tokenize(`${p.description ?? ''} ${p.extract ?? ''}`);
    if (!/\s/.test(title.trim()) && caseWords.length && !caseWords.some((w) => about.includes(w))) return false;
    const now = currentBoard().nodes.find((n) => n.id === nodeId);
    if (!now) return false;
    const image = p.originalimage?.source && (p.originalimage.width ?? 0) <= 1600 ? p.originalimage.source : p.thumbnail?.source;
    const kind = kindFrom(String(p.description ?? ''));
    const patch: Partial<ClueData> = { url: now.data.url ?? p.content_urls?.desktop?.page };
    if (!now.data.image && image) patch.image = image;
    if (kind && (!now.data.entityType || now.data.entityType === 'concept')) patch.entityType = kind;
    if (!now.data.text && (p.description || p.extract)) patch.text = String(p.extract || p.description).slice(0, 300);
    useBoards.getState().updateNode(nodeId, patch);
    return true;
  } catch {
    return false;
  }
}

/** A person, place, event… you name: a card that fills itself in. */
export function addNamedCard(name: string, entityType: EntityType, opts: Opts = {}) {
  const title = name.trim().slice(0, 80);
  const id = addClue('entity', { title, entityType, source: 'mine' }, opts);
  if (title) void fillFromWikipedia(id, title);
  return id;
}

/** A place found on the map (OpenStreetMap), pinned with its location so it shows on the Map view. */
export async function addPlace(query: string, opts: Opts = {}) {
  const [hit] = await api.search('places', query, 1);
  if (!hit) throw new Error(`No place called “${query}” on the map.`);
  return pinItem({ ...hit, kind: hit.kind ?? 'place' }, opts);
}
