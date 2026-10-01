import clsx from 'clsx';
import { Download, Upload, X } from 'lucide-react';
import { PictureButton } from './ShareModal';
import { useRef, type ReactNode } from 'react';
import { SOURCE_GROUPS, SOURCES } from '../../shared/sources';
import { currentBoard, useBoards } from '../store/boards';
import { useSettings, type BoardFont, type ScrollMode, type StringMode } from '../store/settings';
import { useUi } from '../store/ui';
import type { Board } from '../types';
import { THEMES } from './board/Toolbar';
import { Glyph } from './SourceBadge';
import { signOut, useAuth } from '../lib/auth';

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-paper-2">
      <span className={clsx('relative h-5 w-9 shrink-0 rounded-full transition', on ? 'bg-[#c8322f]' : 'bg-ink/20')}>
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span>
        <span className="block text-[13.5px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[12px] text-ink-soft">{hint}</span>}
      </span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 label-caps text-ink-soft">{title}</h3>
      {children}
    </section>
  );
}

function BoardTab() {
  const p = useSettings();
  return (
    <>
      <Section title="Surface">
        <div className="grid grid-cols-5 gap-2.5">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => p.set({ theme: t.id })} className="group text-center">
              <span className={clsx('block h-16 rounded-lg shadow-md transition group-hover:-translate-y-1', p.theme === t.id && 'ring-2 ring-ink ring-offset-2 ring-offset-paper')} style={{ background: t.swatch }} />
              <span className="mt-1.5 block text-[12px] text-ink">{t.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Strings">
        <div className="flex gap-2">
          {(
            [
              ['red', 'Classic red yarn'],
              ['type', 'Colour by kind'],
            ] as [StringMode, string][]
          ).map(([id, label]) => (
            <button key={id} onClick={() => p.set({ stringMode: id })} className={clsx('chip', p.stringMode === id && 'on')}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Handwriting">
        <div className="flex gap-2">
          {(
            [
              ['hand', 'Detective scrawl', 'font-hand text-[17px]'],
              ['type', 'Typewriter', 'font-type'],
              ['clean', 'Clean', 'font-ui'],
            ] as [BoardFont, string, string][]
          ).map(([id, label, family]) => (
            <button key={id} onClick={() => p.set({ font: id })} className={clsx('chip', p.font === id && 'on')} style={{ fontFamily: `var(--${family})`, fontSize: id === 'hand' ? 17 : undefined }}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Scrolling on the board">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['auto', 'Auto-detect'],
              ['pan', 'Scroll moves (trackpad)'],
              ['zoom', 'Scroll zooms (mouse wheel)'],
            ] as [ScrollMode, string][]
          ).map(([id, label]) => (
            <button key={id} onClick={() => p.set({ scroll: id })} className={clsx('chip', p.scroll === id && 'on')}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[12px] text-ink-soft">Pinch or Ctrl + scroll always zooms. Drag the empty cork to move around.</div>
      </Section>
      <Section title="Feel">
        <Toggle on={p.messy} onChange={(messy) => p.set({ messy })} label="Messy pinning" hint="Cards sit slightly crooked, like a real board" />
        <Toggle on={p.frame} onChange={(frame) => p.set({ frame })} label="Wooden frame" />
        <Toggle on={p.showLabels} onChange={(showLabels) => p.set({ showLabels })} label="String labels" hint="Handwritten scraps on the strings" />
        <Toggle on={p.minimap} onChange={(minimap) => p.set({ minimap })} label="Polaroid minimap" />
        <Toggle on={p.sounds} onChange={(sounds) => p.set({ sounds })} label="Sounds" hint="Pins thock, paper rustles, strings twang" />
      </Section>
    </>
  );
}

function SourcesTab() {
  const dig = useSettings((s) => s.digSources);
  const per = useSettings((s) => s.perSource);
  const set = useSettings((s) => s.set);
  const toggle = useSettings((s) => s.toggleSource);
  return (
    <>
      <Section title={`Evidence per source · ${per}`}>
        <input type="range" min={1} max={5} value={per} onChange={(e) => set({ perSource: +e.target.value })} className="w-full accent-[#c8322f]" />
        <div className="text-[12px] text-ink-soft">More evidence means a busier board. {dig.length} sources × {per} = up to {dig.length * per} clues per dig, plus the AI's.</div>
      </Section>
      <Section title="Where every dig searches">
        {SOURCE_GROUPS.map((g) => (
          <div key={g} className="mb-3">
            <div className="mb-1 text-[12px] font-semibold text-ink">{g}</div>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.filter((s) => s.group === g).map((s) => (
                <button key={s.id} onClick={() => toggle('digSources', s.id)} className={clsx('chip !py-1', dig.includes(s.id) && 'on')} title={s.description}>
                  <Glyph id={s.id} /> {s.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

function DataTab() {
  const file = useRef<HTMLInputElement>(null);
  const board = currentBoard();
  const exportBoard = () => {
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${board.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'rabbit-hole'}.rabbithole.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <Section title="This hole">
        <div className="flex flex-wrap gap-2">
          <button onClick={exportBoard} className="chip">
            <Download size={14} /> Export as file
          </button>
          <PictureButton />
          <button onClick={() => file.current?.click()} className="chip">
            <Upload size={14} /> Import a hole
          </button>
          <input
            ref={file}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const b = JSON.parse(await f.text()) as Board;
                if (!Array.isArray(b.nodes)) throw new Error('not a board');
                useBoards.getState().importBoard(b);
                useUi.getState().set({ settingsOpen: false });
              } catch {
                alert('That file is not a Rabbit Hole board.');
              }
            }}
          />
        </div>
        <p className="mt-2 text-[12px] text-ink-soft">Boards are saved automatically in this browser. Export to back one up or share it.</p>
      </Section>
      <Section title="Start over">
        <button
          onClick={() => confirm(`Clear every clue from “${board.name}”?`) && useBoards.getState().clearBoard()}
          className="rounded-md px-3 py-1.5 text-[13px] text-[#b3261e] ring-1 ring-[#b3261e]/30 hover:bg-[#b3261e]/10"
        >
          Clear this board
        </button>
      </Section>
    </>
  );
}

const TABS = [
  { id: 'board', label: 'Board', el: BoardTab },
  { id: 'sources', label: 'Sources', el: SourcesTab },
  { id: 'data', label: 'Save & share', el: DataTab },
] as const;

/** Who is signed in, and the way out. Hidden when sign-in is off. */
function Account() {
  const { status, email, name } = useAuth();
  if (status !== 'signed-in') return null;
  return (
    <div className="ml-auto flex min-w-0 items-center gap-2 font-ui text-[13px] text-ink-soft">
      <a href="/terms.html" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink hover:underline">
        Terms
      </a>
      <a href="/privacy.html" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink hover:underline">
        Privacy
      </a>
      <span className="truncate" title={email}>
        {name ?? email}
      </span>
      <button onClick={() => void signOut()} className="shrink-0 rounded-md border border-ink/20 px-2 py-1 font-medium text-ink hover:bg-ink/10">
        Sign out
      </button>
    </div>
  );
}

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  const set = useUi((s) => s.set);
  if (!open) return null;
  const Active = (TABS.find((t) => t.id === tab) ?? TABS[0]).el;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]" onClick={() => set({ settingsOpen: false })}>
      <div onClick={(e) => e.stopPropagation()} className="paper-panel animate-rise flex max-h-[86vh] w-[min(760px,96vw)] flex-col overflow-hidden rounded-xl rotate-[-0.3deg]">
        <div className="flex items-center gap-4 border-b border-ink/10 px-6 pt-5 pb-3">
          <div className="font-hand text-[30px] leading-none">Customize</div>
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => set({ settingsTab: t.id as typeof tab })} className={clsx('chip', (tab === t.id || (tab === 'ai' && t.id === 'board')) && 'on')}>
                {t.label}
              </button>
            ))}
          </div>
          <Account />
          <button onClick={() => set({ settingsOpen: false })} className="ml-auto rounded-lg p-1.5 hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <Active />
        </div>
      </div>
    </div>
  );
}
