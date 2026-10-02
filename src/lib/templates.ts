import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import type { ClueData, ClueNode, ClueType } from '../types';
import { makeNode, type Point } from './factory';
import { flow, viewportCenter } from './flow';

// Boards you build yourself: a few labelled frames to sort evidence into, ready for your own cards.

type Box = { title: string; color: string; x: number; y: number; w: number; h: number; note?: string };
type Starter = { type: ClueType; data: Partial<ClueData>; x: number; y: number };

export interface Template {
  id: string;
  name: string;
  blurb: string;
  frames: Box[];
  cards: Starter[];
}

export const TEMPLATES: Template[] = [
  {
    id: 'case',
    name: 'Detective case',
    blurb: 'Suspects, evidence, theories and open questions',
    frames: [
      { title: 'Suspects & people', color: '#c8322f', x: -720, y: -480, w: 680, h: 440 },
      { title: 'Evidence', color: '#2f5fb3', x: 40, y: -480, w: 680, h: 440 },
      { title: 'Theories', color: '#9b4dca', x: -720, y: 40, w: 680, h: 440 },
      { title: 'Open questions', color: '#3f8f55', x: 40, y: 40, w: 680, h: 440 },
    ],
    cards: [
      { type: 'question', data: { title: 'What really happened?' }, x: 380, y: 280 },
      { type: 'note', data: { text: 'Theory 1: …', title: 'Theory 1', color: '#e3c7f0' }, x: -380, y: 280 },
    ],
  },
  {
    id: 'theory',
    name: 'Theory vs evidence',
    blurb: 'A claim, what supports it, what contradicts it',
    frames: [
      { title: 'Supports it', color: '#3f8f55', x: -760, y: -300, w: 620, h: 560 },
      { title: 'Contradicts it', color: '#c8322f', x: 140, y: -300, w: 620, h: 560 },
      { title: 'Not sure yet', color: '#e0a526', x: -310, y: 320, w: 620, h: 300 },
    ],
    cards: [{ type: 'question', data: { title: 'The claim: …' }, x: 0, y: -40 }],
  },
  {
    id: 'whos',
    name: "Who's who",
    blurb: 'People, places and groups in one story',
    frames: [
      { title: 'People', color: '#c8322f', x: -760, y: -420, w: 1520, h: 460 },
      { title: 'Places', color: '#2f5fb3', x: -760, y: 100, w: 740, h: 420 },
      { title: 'Groups & organisations', color: '#9b4dca', x: 20, y: 100, w: 740, h: 420 },
    ],
    cards: [],
  },
  {
    id: 'timeline',
    name: 'Timeline board',
    blurb: 'Before, during and after, left to right',
    frames: [
      { title: 'Before', color: '#6b5d4f', x: -1020, y: -320, w: 640, h: 640 },
      { title: 'What happened', color: '#c8322f', x: -320, y: -320, w: 640, h: 640 },
      { title: 'After', color: '#2f5fb3', x: 380, y: -320, w: 640, h: 640 },
    ],
    cards: [],
  },
];

/** Lays a template out around the middle of the view (a blank board just opens the Add menu). */
export function startFromTemplate(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  const c: Point = viewportCenter();
  if (!t) {
    useUi.getState().set({ addMenuAt: Date.now() });
    return;
  }
  const nodes: ClueNode[] = [];
  for (const f of t.frames) {
    const n = makeNode('frame', { x: 0, y: 0 }, { title: f.title, color: f.color, text: f.note });
    n.position = { x: Math.round(c.x + f.x), y: Math.round(c.y + f.y) };
    n.width = f.w;
    n.height = f.h;
    nodes.push(n);
  }
  for (const s of t.cards) nodes.push(makeNode(s.type, { x: c.x + s.x, y: c.y + s.y }, { title: '', ...s.data }));
  const store = useBoards.getState();
  store.snapshot(`Started a “${t.name}” board`);
  store.addNodes(nodes);
  setTimeout(() => {
    void flow()?.fitView({ duration: 600, padding: 0.12 });
    useUi.getState().set({ addMenuAt: Date.now() });
  }, 120);
}
