import clsx from 'clsx';
import { ArrowLeft, Dices, FolderPlus, Hammer, Pin, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildNewCase, digNewCase } from '../lib/home';
import { TEMPLATES } from '../lib/templates';
import { useBoards } from '../store/boards';
import { useUi } from '../store/ui';
import type { Board } from '../types';
import { openEmojiPicker } from './EmojiPicker';
import { newBoard } from './LeftPanel';

interface FileSummary {
  id: string;
  no: number;
  name: string;
  emoji: string;
  clues: number;
  cases: string[];
  photo?: string;
  depth: number;
  updatedAt: number;
  pinned?: boolean;
}

function summarize(b: Board, no: number): FileSummary {
  const topics = b.nodes.filter((n) => n.type === 'topic');
  const photo = topics.find((t) => t.data.image)?.data.image ?? b.nodes.find((n) => n.data.image)?.data.image;
  return {
    id: b.id,
    no,
    name: b.name,
    emoji: b.emoji,
    clues: b.nodes.length,
    cases: topics.map((t) => t.data.title).filter(Boolean),
    photo,
    depth: Math.max(0, ...topics.map((t) => t.data.depth ?? 0)),
    updatedAt: b.updatedAt,
    pinned: b.pinned,
  };
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function openBoard(id: string) {
  useBoards.getState().setCurrent(id);
  useUi.getState().set({ caseFilesOpen: false, view: 'board', selectedNodeId: undefined, selectedEdgeId: undefined });
}

/** Every investigation as a manila folder in a drawer, named on a taped paper label. */
export function CaseFiles() {
  const order = useBoards((s) => s.order);
  const boards = useBoards((s) => s.boards);
  const currentId = useBoards((s) => s.currentId);
  const [q, setQ] = useState('');
  const [topic, setTopic] = useState('');
  const hasOpenBoard = (boards[currentId]?.nodes.length ?? 0) > 0;

  const files = useMemo(
    () =>
      order
        .map((id, i) => (boards[id] ? summarize(boards[id], order.length - i) : null))
        .filter((f): f is FileSummary => !!f)
        .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt),
    [order, boards],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle ? files.filter((f) => [f.name, ...f.cases].some((s) => s.toLowerCase().includes(needle))) : files;

  return (
    <div className="desk relative min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
        {/* Start something new: dig into a topic, or build a board by hand. */}
        <section className="home-start">
          <h1 className="font-serif text-[30px] font-bold leading-[1.05] text-ink md:text-[40px]">
            What do you want to <span className="italic text-[#b3261e]">fall into?</span>
          </h1>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              digNewCase(topic);
            }}
          >
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="a topic, or paste a link"
              className="min-w-0 flex-1 border-b-2 border-dashed border-ink/30 bg-transparent px-1 py-2 font-type text-[16px] text-ink outline-none placeholder:text-ink/40 focus:border-[#b3261e]"
              aria-label="Topic to dig into"
            />
            <button className="btn-stamp shrink-0 px-4 text-[15px]">DIG ↓</button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 flex items-center gap-1 font-ui text-[12px] font-medium text-ink-soft">
              <Hammer size={13} /> Or build your own:
            </span>
            <button className="chip" onClick={() => buildNewCase('blank')}>
              Blank board
            </button>
            {TEMPLATES.map((t) => (
              <button key={t.id} className="chip" onClick={() => buildNewCase(t.id)} title={t.blurb}>
                {t.name}
              </button>
            ))}
            <button
              className="chip"
              onClick={() => digNewCase(['The Voynich Manuscript', 'Numbers stations', 'The Tamam Shud case', 'Dancing plague of 1518', 'The Wow! signal', 'Kowloon Walled City', 'Cicada 3301', 'The Mary Celeste'][Math.floor(Math.random() * 8)])}
            >
              <Dices size={13} /> Surprise me
            </button>
          </div>
        </section>

        <div className="mt-10 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-x-6">
          {hasOpenBoard && (
            <button onClick={() => useUi.getState().set({ caseFilesOpen: false })} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-ui text-[13px] text-paper/70 hover:bg-white/10 hover:text-paper">
              <ArrowLeft size={15} /> Back to the board
            </button>
          )}
          <div className="min-w-0 md:flex-1">
            <h2 className="font-hand text-[38px] leading-none font-bold text-paper md:text-[46px]">Case files</h2>
            <p className="mt-1 font-ui text-[13.5px] text-paper/60">
              {files.length} investigation{files.length === 1 ? '' : 's'} in the drawer. Click a folder to open it; click its sticker to change the icon.
            </p>
          </div>
          <label className="flex w-full items-center gap-2 rounded-lg bg-paper px-3 py-2 sm:w-72">
            <Search size={15} className="text-ink-soft" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a case…"
              className="min-w-0 flex-1 bg-transparent font-ui text-[14px] text-ink outline-none placeholder:text-ink/40"
            />
          </label>
        </div>

        <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-8 gap-y-12 md:mt-12 md:gap-x-10 md:gap-y-14">
          {!needle && (
            <button
              onClick={() => {
                useUi.getState().set({ caseFilesOpen: false });
                newBoard();
              }}
              className="cfile-new"
            >
              <FolderPlus size={30} strokeWidth={1.5} />
              <span className="font-hand text-[26px] leading-none">Open a new case</span>
            </button>
          )}
          {shown.map((f) => (
            <Folder key={f.id} f={f} current={f.id === currentId} />
          ))}
        </div>
        {needle && !shown.length && <p className="mt-10 text-center font-ui text-[14px] text-paper/60">No case file matches “{q}”.</p>}
      </div>
    </div>
  );
}

function Folder({ f, current }: { f: FileSummary; current: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [shredding, setShredding] = useState(false);
  const papers = f.cases.slice(-3);
  // A slight, stable tilt per folder so the drawer looks handled, not printed.
  const tilt = ((f.id.charCodeAt(0) + f.id.charCodeAt(1)) % 5) - 2;

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open ${f.name}`}
      onClick={() => !renaming && !shredding && openBoard(f.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openBoard(f.id)}
      className="cfile"
      style={{ '--tilt': `${tilt * 0.5}deg` } as React.CSSProperties}
    >
      <div className="cfile-tab">
        Case Nº {String(f.no).padStart(3, '0')}
        {current && <span className="cfile-open">on your desk</span>}
      </div>
      <div className="cfile-back" />
      <div className="cfile-papers">
        {(papers.length ? papers : ['Nothing dug up yet']).map((t, i) => (
          <div key={i} className="cfile-paper" style={{ '--i': i } as React.CSSProperties}>
            {t}
          </div>
        ))}
      </div>
      {f.photo && (
        <div className="cfile-photo">
          {/* A photo that won't load takes its frame with it, rather than leaving a broken icon. */}
          <img src={f.photo} alt="" loading="lazy" onError={(e) => ((e.currentTarget.parentElement as HTMLElement).hidden = true)} />
        </div>
      )}
      <div className="cfile-front">
        <button
          className="cfile-sticker"
          title="Change icon"
          onClick={(e) => {
            e.stopPropagation();
            openEmojiPicker(f.id, e.currentTarget);
          }}
        >
          {f.emoji}
        </button>
        <div className="cfile-label" onDoubleClick={(e) => (e.stopPropagation(), setRenaming(true))} title="Double-click to rename">
          {renaming ? (
            <input
              autoFocus
              defaultValue={f.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                useBoards.getState().renameBoard(f.id, e.target.value.trim() || f.name);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="w-full bg-transparent outline-none"
            />
          ) : (
            f.name
          )}
        </div>
        <div className="cfile-meta">
          <span>
            {f.clues} clues · {f.cases.length} case{f.cases.length === 1 ? '' : 's'}
            {f.depth > 0 && ` · depth ${f.depth}`}
          </span>
          {/* The shred button lives on the meta line, so it never lands on the label or stamp. */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            {ago(f.updatedAt)}
            <button
              className={clsx('cfile-trash', f.pinned && '!text-[#c8322f] !opacity-100')}
              title={f.pinned ? 'Unpin' : 'Pin to the top'}
              aria-label={f.pinned ? `Unpin ${f.name}` : `Pin ${f.name}`}
              onClick={(e) => {
                e.stopPropagation();
                useBoards.getState().togglePinBoard(f.id);
              }}
            >
              <Pin size={14} fill={f.pinned ? 'currentColor' : 'none'} />
            </button>
            <button
              className="cfile-trash"
              title="Shred this file"
              aria-label={`Shred ${f.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setShredding(true);
              }}
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
        {shredding && (
          <div className="cfile-shred" onClick={(e) => e.stopPropagation()}>
            <span>Shred this file? It can’t be undone.</span>
            <button onClick={() => useBoards.getState().deleteBoard(f.id)} className="rounded bg-[#b3261e] px-2 py-0.5 font-semibold text-white">
              Shred
            </button>
            <button onClick={() => setShredding(false)} className="rounded px-2 py-0.5 hover:bg-ink/10">
              Keep
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
