import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SOURCES } from '../../shared/sources';

// Per-user preferences only. No API keys or AI provider config ever lives in the
// browser. That is all in the server's .env.

export type BoardTheme = 'cork' | 'void' | 'blueprint' | 'chalk' | 'paper';
export type StringMode = 'red' | 'type';
export type BoardFont = 'hand' | 'type' | 'clean';
/** What scrolling does on the board: auto-detects trackpad (pan) vs mouse wheel (zoom). */
export type ScrollMode = 'auto' | 'pan' | 'zoom';

interface Prefs {
  digSources: string[];
  searchSources: string[];
  perSource: number;
  theme: BoardTheme;
  stringMode: StringMode;
  font: BoardFont;
  scroll: ScrollMode;
  messy: boolean;
  showLabels: boolean;
  minimap: boolean;
  frame: boolean;
  /** Cards snap to a 20px grid when dragged. */
  snap: boolean;
  sounds: boolean;
  researchChat: boolean;
  /** Send the board (or selected card) to the partner with each question. */
  chatUsesBoard: boolean;
  leftWidth: number;
  rightWidth: number;
}

interface SettingsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  toggleSource: (list: 'digSources' | 'searchSources', id: string) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      digSources: SOURCES.filter((s) => s.dig).map((s) => s.id),
      searchSources: ['wikipedia', 'web', 'reddit', 'archive', 'youtube', 'commons', 'atlasobscura'],
      perSource: 3,
      theme: 'cork',
      stringMode: 'red',
      font: 'hand',
      scroll: 'auto',
      messy: true,
      showLabels: true,
      minimap: true,
      frame: true,
      snap: false,
      sounds: true,
      researchChat: true,
      chatUsesBoard: true,
      leftWidth: 260,
      rightWidth: 420,
      set: (patch) => set(patch),
      toggleSource: (list, id) =>
        set((s) => ({ [list]: s[list].includes(id) ? s[list].filter((x) => x !== id) : [...s[list], id] })),
    }),
    {
      name: 'rabbit-hole-prefs',
      version: 4,
      // v3: sources backed by newly added free keys join every dig.
      migrate: (saved, version) => {
        const s = saved as SettingsState;
        if (version < 3 && Array.isArray(s?.digSources)) s.digSources = [...new Set([...s.digSources, 'smithsonian', 'courtlistener', 'github'])];
        // v4: more forums.
        if (version < 4 && Array.isArray(s?.digSources)) s.digSources = [...new Set([...s.digSources, 'forums', 'lemmy'])];
        return s;
      },
    },
  ),
);
