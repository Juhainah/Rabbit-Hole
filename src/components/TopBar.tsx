import clsx from 'clsx';
import { CalendarRange, ChevronDown, CircleHelp, FolderOpen, LayoutDashboard, Map as MapIcon, Network, Plus, Settings2, X } from 'lucide-react';
import { useState } from 'react';
import { startDig } from '../lib/dig';
import { useShallow } from 'zustand/react/shallow';
import { useBoards } from '../store/boards';
import { useUi, type View } from '../store/ui';
import { newBoard } from './LeftPanel';
import { CloudStatus } from './ShareModal';

export function Logo() {
  return (
    <div className="flex shrink-0 select-none items-center gap-2 whitespace-nowrap">
      <svg width="34" height="34" viewBox="0 0 40 40" className="shrink-0">
        <ellipse cx="20" cy="31" rx="16" ry="6" fill="#000" />
        <ellipse cx="20" cy="31" rx="16" ry="6" fill="none" stroke="#6b4a2f" strokeWidth="2" />
        <path d="M15 30 C 11 18, 11 6, 15 4 C 19 3, 19 18, 19 30 Z" fill="#f4ede1" stroke="#1b1511" strokeWidth="1.2" />
        <path d="M22 30 C 22 17, 24 3, 28 5 C 32 8, 28 20, 26 30 Z" fill="#f4ede1" stroke="#1b1511" strokeWidth="1.2" />
        <path d="M16 27 C 14 19, 14 9, 16 7 C 17.5 7, 17.5 19, 18 27 Z" fill="#f2b8b0" />
        <path d="M23.5 27 C 24 19, 25.5 9, 27 8.5 C 28.5 10, 26.5 20, 25 27 Z" fill="#f2b8b0" />
      </svg>
      <div className="leading-none">
        <div className="hidden font-hand text-[29px] font-bold tracking-tight text-paper min-[1280px]:block">Rabbit Hole</div>
      </div>
    </div>
  );
}

const VIEWS: { id: View; label: string; icon: typeof Network }[] = [
  { id: 'board', label: 'Board', icon: LayoutDashboard },
  { id: 'graph', label: 'Web', icon: Network },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
];

const DEPTH_NAMES = ['the surface', 'the burrow', 'going under', 'no signal', 'point of no return', 'wonderland'];

function DepthMeter() {
  const depth = useBoards((s) => Math.max(0, ...(s.boards[s.currentId]?.nodes ?? []).filter((n) => n.type === 'topic').map((n) => n.data.depth ?? 0)));
  const count = useBoards((s) => s.boards[s.currentId]?.nodes.length ?? 0);
  const level = Math.min(depth, 5);
  return (
    <div className="hidden shrink-0 items-center gap-2.5 whitespace-nowrap md:flex" title={`Depth ${depth}: ${DEPTH_NAMES[level]} · ${count} clues on this board`}>
      <div className="relative h-9 w-3 overflow-hidden rounded-full bg-[#0c0907] ring-1 ring-white/10">
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-[#8ea67c] via-[#7e5a9b] to-[#c8322f] transition-all duration-700" style={{ height: `${18 + level * 16.4}%` }} />
      </div>
      <div className="hidden leading-tight min-[2000px]:block">
        <div className="label-caps !text-paper/50">depth {depth}</div>
        <div className="font-hand text-[18px] text-paper/90">{DEPTH_NAMES[level]}</div>
      </div>
    </div>
  );
}

function DigBar() {
  const [q, setQ] = useState('');
  const selectedId = useUi((s) => s.selectedNodeId);
  const selected = useBoards((s) => (selectedId ? s.boards[s.currentId]?.nodes.find((n) => n.id === selectedId) : undefined));
  const digging = useUi((s) => s.digging);
  return (
    <form
      className="dig-strip relative flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-3 pr-1 rotate-[-0.4deg] max-w-[640px]"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (!v) return;
        if (/^https?:\/\//.test(v)) void startDig({ query: '', url: v, parentId: selected?.id });
        else void startDig({ query: v, parentId: selected?.id });
        setQ('');
      }}
    >
      <span className="washi absolute -left-2 -top-1.5 h-4 w-10 rotate-[-12deg]" />
      {selected && (
        <span className="hidden max-w-[180px] shrink-0 sm:flex items-center gap-1 rounded bg-ink/10 py-0.5 pl-2 pr-1 text-[11px] text-ink">
          <span className="truncate">↳ from {selected.data.title || 'selection'}</span>
          <button type="button" onClick={() => useUi.getState().select()} className="rounded p-0.5 hover:bg-ink/10" title="Start a fresh case instead">
            <X size={11} />
          </button>
        </span>
      )}
      <input
        id="dig-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={selected ? 'follow a tangent from here…' : 'What do you want to fall into?'}
        className="min-w-0 flex-1 bg-transparent py-1.5 font-type text-[15px] text-ink outline-none placeholder:text-ink/40"
      />
      <button className="btn-stamp shrink-0 px-4 py-1.5 text-[13px]">{digging ? 'DIGGING…' : 'DIG ↓'}</button>
    </form>
  );
}

/** Opens (or closes) the Case Files page. */
function CaseFilesButton() {
  const open = useUi((s) => s.caseFilesOpen);
  return (
    <button
      onClick={() => useUi.getState().set({ caseFilesOpen: !open })}
      className={clsx('flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition', open ? 'bg-paper text-ink' : 'text-paper/75 hover:bg-white/5 hover:text-paper')}
      title="Every board as a case file"
    >
      <FolderOpen size={16} />
      <span className="hidden whitespace-nowrap min-[1700px]:inline">Case files</span>
    </button>
  );
}

/** Current board name with a dropdown to switch, rename, or start a new board. */
function BoardSwitcher() {
  const [open, setOpen] = useState(false);
  const rows = useBoards(useShallow((s) => s.order.map((id) => `${id}\u0000${s.boards[id]?.emoji}\u0000${s.boards[id]?.name}`)));
  const currentId = useBoards((s) => s.currentId);
  const current = rows.find((r) => r.startsWith(`${currentId}\u0000`))?.split('\u0000') ?? [];
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((o) => !o)} className="flex max-w-[150px] items-center gap-2 rounded-lg px-2.5 py-1.5 text-paper/85 transition hover:bg-white/5 hover:text-paper min-[1500px]:max-w-[220px]" title="Switch board">
        <span className="text-[17px]">{current[1]}</span>
        <span className="hidden truncate text-[13.5px] font-medium sm:inline">{current[2]}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="paper-panel animate-rise absolute left-0 top-[42px] z-50 w-[270px] rounded-xl p-1.5">
            <button
              onClick={() => {
                newBoard();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px] font-semibold text-[#b3261e] hover:bg-paper-2"
            >
              <Plus size={15} /> New board
            </button>
            <button
              onClick={() => {
                useUi.getState().set({ caseFilesOpen: true });
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-paper-2"
            >
              <FolderOpen size={15} /> All case files
            </button>
            <div className="my-1 h-px bg-ink/10" />
            <div className="max-h-[320px] overflow-y-auto">
              {rows.map((r) => {
                const [id, emoji, name] = r.split('\u0000');
                return (
                  <button
                    key={id}
                    onClick={() => {
                      useBoards.getState().setCurrent(id);
                      useUi.getState().set({ selectedNodeId: undefined, selectedEdgeId: undefined });
                      setOpen(false);
                    }}
                    className={clsx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] hover:bg-paper-2', id === currentId && 'bg-paper-2 font-semibold')}
                  >
                    <span>{emoji}</span>
                    <span className="truncate">{name}</span>
                  </button>
                );
              })}
            </div>
            <div className="my-1 h-px bg-ink/10" />
            <button
              onClick={() => {
                const name = prompt('Rename this board', current[2]);
                if (name?.trim()) useBoards.getState().renameBoard(currentId, name.trim());
                setOpen(false);
              }}
              className="w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-paper-2"
            >
              ✎ Rename this board
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const view = useUi((s) => s.view);
  const set = useUi((s) => s.set);
  return (
    <header className="top-bar desk relative z-30 flex h-[62px] shrink-0 items-center gap-1.5 border-b md:gap-2.5 min-[1500px]:gap-4 border-black/50 px-3 shadow-[0_8px_20px_-12px_rgba(0,0,0,.9)]">
      <div className="hidden md:block">
        <Logo />
      </div>
      <span className="hidden h-6 w-px bg-white/10 md:block" />
      <BoardSwitcher />
      <div className="hidden md:block">
        <CaseFilesButton />
      </div>
      <button onClick={newBoard} className="hidden shrink-0 items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12.5px] text-paper/80 transition hover:border-white/35 hover:text-paper lg:flex" title="Start a new board">
        <Plus size={14} />
        <span className="hidden whitespace-nowrap min-[1700px]:inline">New board</span>
      </button>
      <div className="flex min-w-0 flex-1 justify-center px-1 md:min-w-[320px]">
        <DigBar />
      </div>
      <nav className="hidden shrink-0 items-end gap-1 self-end md:flex">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => set({ view: v.id, caseFilesOpen: false })} title={v.label} aria-label={v.label} className={clsx('index-tab flex items-center gap-1.5', view === v.id && 'on')}>
            <v.icon size={14} />
            <span className="hidden min-[1900px]:inline">{v.label}</span>
          </button>
        ))}
      </nav>
      <DepthMeter />
      <div className="flex shrink-0 items-center whitespace-nowrap">
        <CloudStatus />
      </div>
      <button onClick={() => set({ helpOpen: true })} className="hidden rounded-lg p-2 text-paper/60 hover:bg-white/5 hover:text-paper md:block" title="How it works">
        <CircleHelp size={18} />
      </button>
      <button onClick={() => set({ settingsOpen: true })} className="rounded-lg p-2 text-paper/60 hover:bg-white/5 hover:text-paper" title="Customize">
        <Settings2 size={18} />
      </button>
    </header>
  );
}
