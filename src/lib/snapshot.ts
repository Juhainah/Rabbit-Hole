import { toPng } from 'html-to-image';
import { currentBoard } from '../store/boards';
import { useUi } from '../store/ui';
import { api } from './api';
import { flow } from './flow';

// "Save the board as a picture": the whole board (not just what's on screen) as a PNG,
// on its own background, with a caption strip naming the board and the app. Made for
// posting: a screenshot of a board is how most people will first see Rabbit Hole.

const MAX_SIDE = 3200;
const PAD = 90;
const CAPTION = 70;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function waitFor<T>(get: () => T | null | undefined, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v) return v;
    if (Date.now() > end) throw new Error("The board didn't open.");
    await nextFrame();
  }
}

/** Photos from other sites can't be copied into a picture directly, so they come through our server. */
async function inlineForeignImages(root: HTMLElement) {
  const undo: (() => void)[] = [];
  await Promise.all(
    [...root.querySelectorAll('img')].map(async (img) => {
      // Lazy photos never count as "in view" inside the picture, so they'd stay blank.
      if (img.loading === 'lazy') {
        img.loading = 'eager';
        undo.push(() => (img.loading = 'lazy'));
      }
      const src = img.currentSrc || img.src;
      if (!src || /^(data|blob):/.test(src) || new URL(src, location.href).origin === location.origin) return;
      try {
        const data = await blobToDataUrl(await api.image(src));
        const { srcset } = img;
        img.removeAttribute('srcset');
        img.src = data;
        await img.decode().catch(() => undefined);
        undo.push(() => {
          img.src = src;
          if (srcset) img.srcset = srcset;
        });
      } catch {
        /* that photo stays blank in the picture */
      }
    }),
  );
  return () => undo.forEach((u) => u());
}

/** The board's own surface: the cork tile on cork boards, its colour otherwise. */
async function paintBackground(ctx: CanvasRenderingContext2D, board: HTMLElement, w: number, h: number, zoom: number) {
  const css = getComputedStyle(board);
  const color = css.backgroundColor;
  ctx.fillStyle = !color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent' ? '#17120e' : color;
  ctx.fillRect(0, 0, w, h);
  if (!board.classList.contains('theme-cork')) return;
  const tile = getComputedStyle(document.documentElement).getPropertyValue('--cork').match(/url\(["']?(.+?)["']?\)/)?.[1];
  if (!tile) return;
  const pattern = ctx.createPattern(await loadImage(tile), 'repeat');
  if (!pattern) return;
  // The tile shrinks with the cards, as it does on screen.
  pattern.setTransform(new DOMMatrix().scale(zoom));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}

const fileName = (name: string) => `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'rabbit-hole'}.png`;

/** Draws the whole current board as a PNG and downloads it. */
export async function downloadBoardPicture() {
  const board = currentBoard();
  if (!board?.nodes.length) throw new Error('Pin something to this board first.');
  const ui = useUi.getState();
  const before = { selectedNodeId: ui.selectedNodeId, selectedEdgeId: ui.selectedEdgeId };
  // The picture comes from the board view, with nothing selected or dimmed.
  ui.set({ view: 'board', caseFilesOpen: false, selectedNodeId: undefined, selectedEdgeId: undefined, spotlight: [], menu: undefined });
  const boardEl = await waitFor(() => document.querySelector<HTMLElement>('.board:not(.shared-board)'));
  const viewport = await waitFor(() => boardEl.querySelector<HTMLElement>('.react-flow__viewport'));
  const rf = await waitFor(() => flow());
  await nextFrame();

  const b = rf.getNodesBounds(rf.getNodes());
  const zoom = Math.min(1.25, MAX_SIDE / (Math.max(b.width, b.height) + PAD * 2));
  const width = Math.round((b.width + PAD * 2) * zoom);
  const height = Math.round((b.height + PAD * 2) * zoom);

  // Full detail on every card, whatever the zoom on screen. Card buttons (Ask, Keep falling)
  // mean nothing in a picture: they're hidden, not removed, so no card changes size.
  const lod = boardEl.dataset.lod;
  boardEl.dataset.lod = 'near';
  const hide = document.createElement('style');
  hide.textContent = '.react-flow__node .clue-actions, .react-flow__node .clue-btn, .react-flow__node .btn-stamp { visibility: hidden !important; }';
  document.head.appendChild(hide);
  const restoreImages = await inlineForeignImages(viewport);
  let png: string;
  try {
    png = await toPng(viewport, {
      width,
      height,
      pixelRatio: 1,
      imagePlaceholder: PIXEL,
      cacheBust: false,
      // A playing video can't be drawn; its card still shows the title.
      filter: (n) => !(n instanceof HTMLIFrameElement),
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${(PAD - b.x) * zoom}px, ${(PAD - b.y) * zoom}px) scale(${zoom})`,
      },
    });
  } finally {
    restoreImages();
    hide.remove();
    if (lod) boardEl.dataset.lod = lod;
    useUi.getState().set(before);
  }

  const shot = await loadImage(png);
  const W = Math.max(width, 1200);
  const H = height + CAPTION;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  await paintBackground(ctx, boardEl, W, height, zoom);
  ctx.drawImage(shot, Math.round((W - width) / 2), 0);

  // Caption strip: the board's name, and where it was made.
  ctx.fillStyle = '#17120e';
  ctx.fillRect(0, height, W, CAPTION);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6efe1';
  ctx.font = '700 34px Caveat, "Segoe Print", cursive';
  ctx.fillText(`${board.emoji} ${board.name}`.slice(0, 80), 28, height + CAPTION / 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(246, 239, 225, 0.7)';
  ctx.font = '500 17px Inter, system-ui, sans-serif';
  ctx.fillText(`Made with Rabbit Hole · ${location.host}`, W - 28, height + CAPTION / 2);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error("Couldn't make the picture.");
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(board.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
