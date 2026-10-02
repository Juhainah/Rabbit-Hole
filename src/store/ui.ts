import { nanoid } from 'nanoid';
import { create } from 'zustand';

export type View = 'board' | 'graph' | 'map' | 'timeline';
export type RightTab = 'ai' | 'search' | 'inspect' | 'read';

export interface ActivityLine {
  id: string;
  at: number;
  text: string;
  source?: string;
  level: 'info' | 'ok' | 'warn' | 'err';
}

interface UiState {
  view: View;
  rightTab: RightTab;
  rightOpen: boolean;
  leftOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  settingsTab: 'ai' | 'sources' | 'board' | 'data';
  selectedNodeId?: string;
  selectedEdgeId?: string;
  activity: ActivityLine[];
  digging: number;
  searchPrefill?: { q: string; at: number };
  chatPrefill?: { text: string; at: number };
  readerUrl?: string;
  focusRequest?: { ids: string[]; at: number; soft?: boolean };
  menu?: { x: number; y: number; nodeId?: string; edgeId?: string };
  arranging?: boolean;
  /** Dragging on empty board draws a box that selects many cards. */
  selecting?: boolean;
  /** Set to open the toolbar's Add menu (from the empty board, the phone bar…). */
  addMenuAt?: number;
  toast?: { text: string; at: number; undo?: boolean };
  /** Card types picked in "On this board": those stay lit, the rest fade back. */
  spotlight: string[];
  /** The Case Files page: every board as a folder. */
  caseFilesOpen: boolean;
  /** Which board's emoji is being picked, and where the picker opens. */
  emojiFor?: { boardId: string; x: number; y: number };
  /** The card picker for tying (from) or moving one end of an existing string (edgeId). */
  tiePicker?: { from: string; edgeId?: string };
  /** The string whose label is being typed on the board. */
  labelEdit?: string;

  set: (patch: Partial<UiState>) => void;
  log: (text: string, level?: ActivityLine['level'], source?: string) => void;
  select: (nodeId?: string, edgeId?: string) => void;
  openTab: (tab: RightTab) => void;
  focusNodes: (ids: string[], soft?: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  view: 'board',
  rightTab: 'ai',
  // Phones start on the board itself; the panels open as a drawer and a bottom sheet.
  rightOpen: typeof window === 'undefined' || window.innerWidth >= 768,
  leftOpen: typeof window === 'undefined' || window.innerWidth >= 768,
  settingsOpen: false,
  helpOpen: (() => {
    try {
      return !localStorage.getItem('rh-seen-help');
    } catch {
      return false;
    }
  })(),
  settingsTab: 'ai',
  activity: [],
  digging: 0,
  spotlight: [],
  caseFilesOpen: false,

  set: (patch) => set(patch),
  log: (text, level = 'info', source) =>
    set((s) => ({ activity: [...s.activity.slice(-80), { id: nanoid(6), at: Date.now(), text, level, source }] })),
  select: (nodeId, edgeId) => set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),
  openTab: (tab) => set({ rightTab: tab, rightOpen: true }),
  focusNodes: (ids, soft) => set({ focusRequest: { ids, at: Date.now(), soft }, view: 'board' }),
}));
