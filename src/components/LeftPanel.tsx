import clsx from 'clsx';
import { ChevronsLeft, ChevronsRight, CircleHelp, FolderOpen, Plus, Trash2, Pin as PinIcon } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TYPE_COLORS, TYPE_LABEL } from '../lib/utils';
import { currentBoard, useBoards } from '../store/boards';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import type { ClueType, TrailStep } from '../types';
import { openEmojiPicker } from './EmojiPicker';
import { confirmAsk } from './Dialog';
import { ResizeHandle } from './ResizeHandle';

const NO_TRAIL: TrailStep[] = [];

/** New board, then straight to the dig bar. */
export function newBoard() {
  useBoards.getState().createBoard();
  useUi.getState().set({ selectedNodeId: undefined, selectedEdgeId: undefined, view: 'board' });
  setTimeout(() => document.getElementById('dig-input')?.focus(), 50);
}

function Boards() {
  // One short string per board, so this list ignores card drags and dig updates.
  const rows = useBoards(
    useShallow((s) =>
      // Pinned boards first, then the one you worked on most recently.
      [...s.order]
        .filter((id) => s.boards[id])
        .sort((a, b) => Number(!!s.boards[b].pinned) - Number(!!s.boards[a].pinned) || s.boards[b].updatedAt - s.boards[a].updatedAt)
        .map((id) => {
          const b = s.boards[id];
          return `${id}\u0000${b.emoji}\u0000${b.name}\u0000${b.nodes.length}\u0000${b.trail.length}\u0000${b.pinned ? 1 : ''}`;
        }),
    ),
  );
  const currentId = useBoards((s) => s.currentId);
  const [editing, setEditing] = useState<string | null>(null);
  const { setCurrent, renameBoard, deleteBoard } = useBoards.getState();

  return (
    <section>
      <button onClick={newBoard} className="btn-stamp flex w-full items-center justify-center gap-2 py-2 text-[13px] tracking-wider">
        <Plus size={15} /> NEW BOARD
      </button>
      <div className="mt-5 flex items-center justify-between gap-2">
        <h3 className="label-caps text-ink-soft">Your boards</h3>
        <button onClick={() => useUi.getState().set({ caseFilesOpen: true })} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-ui text-[12px] text-ink-soft hover:bg-ink/10 hover:text-ink" title="See every board as a case file">
          <FolderOpen size={13} /> Case files
        </button>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1">
        {rows.map((row) => {
          const [id, emoji, name, clues, digs, pinned] = row.split('\u0000');
          if (!id) return null;
          const on = id === currentId;
          return (
            <div
              key={id}
              onClick={() => {
                setCurrent(id);
                useUi.getState().set({ selectedNodeId: undefined, selectedEdgeId: undefined });
              }}
              className={clsx(
                'group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition',
                on ? 'bg-[#fffdf7] shadow-[0_3px_8px_-4px_rgba(0,0,0,.35)] rotate-[-0.6deg]' : 'hover:bg-paper-2',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEmojiPicker(id, e.currentTarget);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-md text-[18px] transition hover:scale-110 hover:bg-ink/10"
                title="Change icon"
              >
                {emoji}
              </button>
              <div className="min-w-0 flex-1">
                {editing === id ? (
                  <input
                    autoFocus
                    defaultValue={name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameBoard(id, e.target.value.trim() || name);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="w-full rounded bg-white px-1 text-[13.5px] outline-none"
                  />
                ) : (
                  <div onDoubleClick={() => setEditing(id)} className="line-clamp-2 break-words text-[13.5px] leading-snug font-medium text-ink" title={`${name} (double-click to rename)`}>
                    {name}
                  </div>
                )}
                <div className="text-[11px] text-ink-soft">
                  {clues} clues · {digs} digs
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  useBoards.getState().togglePinBoard(id);
                }}
                className={clsx('rounded p-1 transition hover:bg-ink/10', pinned ? 'text-[#c8322f] opacity-100' : 'text-ink-soft opacity-0 group-hover:opacity-100')}
                title={pinned ? 'Unpin' : 'Pin to the top'}
                aria-label={pinned ? 'Unpin board' : 'Pin board'}
              >
                <PinIcon size={13} fill={pinned ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void confirmAsk(`Delete “${name}”?`, 'The board and everything on it will be gone. This can\'t be undone.', { ok: 'Delete', danger: true }).then((ok) => ok && deleteBoard(id));
                }}
                className="rounded p-1 text-ink-soft opacity-0 transition hover:bg-ink/10 hover:text-[#b3261e] group-hover:opacity-100"
                title="Delete board"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Trail() {
  const trail = useBoards((s) => s.boards[s.currentId]?.trail ?? NO_TRAIL);
  if (!trail.length) return null;
  return (
    <section className="mt-6">
      <h3 className="label-caps text-ink-soft">Your path down</h3>
      <div className="relative mt-2 pl-1">
        {trail.map((t, i) => (
          <button
            key={`${t.nodeId}${i}`}
            onClick={() => useUi.getState().focusNodes([t.nodeId])}
            className="group relative flex w-full items-start gap-2 py-1.5 text-left"
            style={{ paddingLeft: Math.min(t.depth, 6) * 12 }}
            title="Jump to this case on the board"
          >
            <span className="mt-[3px] text-[12px] opacity-70 transition group-hover:scale-125">{i === 0 ? '🕳️' : '🐾'}</span>
            <span className="text-[13px] leading-snug text-ink group-hover:text-[#b3261e]">{t.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Inventory() {
  const summary = useBoards((s) => {
    const m = new Map<string, number>();
    for (const n of s.boards[s.currentId]?.nodes ?? []) m.set(String(n.type), (m.get(String(n.type)) ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}:${c}`)
      .join('|');
  });
  const spotlight = useUi((s) => s.spotlight);
  if (!summary) return null;
  // Click a type to light those cards up and fade the rest; click more to add, again to remove.
  const toggle = (t: string) => {
    const next = spotlight.includes(t) ? spotlight.filter((x) => x !== t) : [...spotlight, t];
    useUi.getState().set({ spotlight: next });
    if (next.length) useUi.getState().focusNodes(currentBoard().nodes.filter((n) => next.includes(String(n.type))).map((n) => n.id), true);
  };
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="label-caps text-ink-soft">On this board</h3>
        {spotlight.length > 0 && (
          <button onClick={() => useUi.getState().set({ spotlight: [] })} className="rounded-md px-1.5 py-0.5 font-ui text-[12px] text-[#b3261e] hover:bg-ink/10">
            Show all
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {summary.split('|').map((pair) => {
          const [t, c] = pair.split(':') as [ClueType, string];
          const on = spotlight.includes(t);
          return (
            <button key={t} onClick={() => toggle(t)} aria-pressed={on} className={clsx('chip', on && 'on')} title={on ? 'Stop highlighting these' : `Highlight every ${TYPE_LABEL[t].toLowerCase()} and fade the rest`}>
              <span className="size-2 rounded-full" style={{ background: TYPE_COLORS[t], boxShadow: on ? '0 0 0 2px rgba(255,255,255,.7)' : undefined }} />
              {TYPE_LABEL[t]} <b>{c}</b>
            </button>
          );
        })}
      </div>
      <p className="mt-2 font-ui text-[11.5px] leading-snug text-ink-soft">{spotlight.length ? 'Only these are lit. Esc or “Show all” to bring back the rest.' : 'Click a type to spotlight it on the board.'}</p>
    </section>
  );
}

export function LeftPanel() {
  const width = useSettings((s) => s.leftWidth);
  const set = useSettings((s) => s.set);
  return (
    <aside className="side-left paper-panel ruled relative z-20 flex shrink-0 flex-col" style={{ width }}>
      <ResizeHandle edge="right" width={width} min={210} max={420} initial={260} onResize={(leftWidth) => set({ leftWidth })} onCollapse={() => useUi.getState().set({ leftOpen: false })} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-caps text-ink-soft">Investigations</span>
        <button onClick={() => useUi.getState().set({ leftOpen: false })} className="rounded-md p-1 text-ink-soft hover:bg-ink/10 hover:text-ink" title="Collapse sidebar">
          <ChevronsLeft size={16} />
        </button>
      </div>
      <Boards />
      <Trail />
      <Inventory />
      <button onClick={() => useUi.getState().set({ helpOpen: true })} className="mt-auto pt-6 text-left text-[12.5px] leading-snug text-ink-soft hover:text-[#b3261e]">
        new here? <u>how Rabbit Hole works →</u>
      </button>
      </div>
    </aside>
  );
}

/** What the left sidebar shrinks to: a slim rail that is still useful. */
export function LeftRail() {
  const open = () => useUi.getState().set({ leftOpen: true });
  return (
    <aside className="side-rail relative z-20 flex w-11 shrink-0 flex-col items-center gap-1 border-r border-black/40 bg-desk-2 py-3">
      <button onClick={open} className="rounded-lg p-2 text-paper/70 hover:bg-white/5 hover:text-paper" title="Show boards">
        <ChevronsRight size={17} />
      </button>
      <button onClick={newBoard} className="rounded-lg p-2 text-paper/70 hover:bg-white/5 hover:text-paper" title="New board">
        <Plus size={17} />
      </button>
      <button onClick={() => useUi.getState().set({ helpOpen: true })} className="mt-auto rounded-lg p-2 text-paper/50 hover:bg-white/5 hover:text-paper" title="How it works">
        <CircleHelp size={17} />
      </button>
    </aside>
  );
}
