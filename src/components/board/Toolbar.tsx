import clsx from 'clsx';
import { CircleHelp, LayoutGrid, Link2, Maximize, Palette, Search, StickyNote, Tag } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { addClue, pinUrl } from '../../lib/dig';
import { flow } from '../../lib/flow';
import { arrange, ARRANGE_LABEL, type ArrangeMode } from '../../lib/layout';
import { play } from '../../lib/sound';
import { currentBoard, useBoards } from '../../store/boards';
import { useSettings, type BoardTheme } from '../../store/settings';
import { useUi } from '../../store/ui';

export const THEMES: { id: BoardTheme; name: string; swatch: string }[] = [
  { id: 'cork', name: 'Cork board', swatch: 'radial-gradient(circle at 30% 30%, #d9a56b, #b27b43)' },
  { id: 'void', name: 'Mind palace', swatch: 'radial-gradient(circle at 30% 30%, #2a2a40, #0b0b10)' },
  { id: 'blueprint', name: 'Blueprint', swatch: 'linear-gradient(135deg, #2a5aa6, #1d4a8f)' },
  { id: 'chalk', name: 'Chalkboard', swatch: 'radial-gradient(circle at 30% 30%, #4a6c56, #22382c)' },
  { id: 'paper', name: 'Scrapbook', swatch: 'linear-gradient(135deg, #f8f1e2, #e8dcc2)' },
];

export function runArrange(mode: ArrangeMode) {
  const board = currentBoard();
  const positions = arrange(board.nodes, board.edges, mode);
  const ui = useUi.getState();
  useBoards.getState().snapshot(`Re-arranged the board (${ARRANGE_LABEL[mode].toLowerCase()})`);
  ui.set({ arranging: true });
  useBoards.getState().updateNodes((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
  play('paper');
  setTimeout(() => {
    useUi.getState().set({ arranging: false });
    void flow()?.fitView({ duration: 700, padding: 0.12 });
  }, 750);
}

function Tool({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={clsx(
        'group relative grid size-10 place-items-center rounded-xl text-ink transition hover:-translate-y-1 hover:rotate-[-4deg] hover:bg-paper-2',
        active && 'bg-paper-2',
      )}
    >
      {icon}
      <span className="pointer-events-none absolute -top-8 whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] text-paper opacity-0 transition group-hover:opacity-100">
        {label}
      </span>
    </button>
  );
}

export function Toolbar() {
  const [open, setOpen] = useState<'link' | 'arrange' | 'theme' | 'find' | null>(null);
  const [link, setLink] = useState('');
  const [find, setFind] = useState('');
  const matches = open === 'find' && find.trim().length > 1
    ? currentBoard()
        .nodes.filter((n) => `${n.data.title} ${n.data.text ?? ''}`.toLowerCase().includes(find.trim().toLowerCase()))
        .slice(0, 8)
    : [];
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const selected = useUi((s) => s.selectedNodeId);
  const toggle = (k: typeof open) => setOpen((o) => (o === k ? null : k));

  return (
    <div className="absolute bottom-7 left-1/2 z-20 -translate-x-1/2">
      {open && (
        <div className="paper-panel animate-rise absolute bottom-[62px] left-1/2 -translate-x-1/2 rounded-xl p-3 min-w-[260px]">
          {open === 'link' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!/^https?:\/\//.test(link.trim())) return;
                pinUrl(link.trim(), { near: selected });
                setLink('');
                setOpen(null);
              }}
            >
              <div className="font-hand text-[19px] leading-none mb-2">Pin a link, image or video</div>
              <input
                autoFocus
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://…"
                className="w-[320px] rounded-md border border-ink/20 bg-white px-3 py-2 text-[13px] outline-none focus:border-ink/50"
              />
              <div className="mt-1.5 text-[11px] text-ink-soft">Pages are read for you. Dead links come back from the Wayback Machine.</div>
            </form>
          )}
          {open === 'find' && (
            <div className="w-[320px]">
              <div className="font-hand text-[19px] leading-none mb-2">Find a card on this board</div>
              <input
                autoFocus
                value={find}
                onChange={(e) => setFind(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches[0]) {
                    useUi.getState().select(matches[0].id);
                    useUi.getState().focusNodes([matches[0].id]);
                  }
                }}
                placeholder="a name, place, word…"
                className="w-full rounded-md border border-ink/20 bg-white px-3 py-2 text-[13px] outline-none focus:border-ink/50"
              />
              <div className="mt-1.5 grid max-h-[240px] gap-0.5 overflow-y-auto">
                {matches.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      useUi.getState().select(n.id);
                      useUi.getState().focusNodes([n.id]);
                    }}
                    className="truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-paper-2"
                  >
                    {n.data.title || '(untitled)'}
                  </button>
                ))}
                {find.trim().length > 1 && !matches.length && <div className="px-2 py-1.5 text-[12.5px] text-ink-soft">No card mentions that.</div>}
              </div>
            </div>
          )}
          {open === 'arrange' && (
            <div className="grid gap-1">
              <div className="font-hand text-[19px] leading-none mb-1">Re-pin the board…</div>
              {(Object.keys(ARRANGE_LABEL) as ArrangeMode[]).map((m) => (
                <button
                  key={m}
                  className="rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-paper-2"
                  onClick={() => {
                    runArrange(m);
                    setOpen(null);
                  }}
                >
                  {ARRANGE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
          {open === 'theme' && (
            <div>
              <div className="font-hand text-[19px] leading-none mb-2">Board surface</div>
              <div className="flex gap-2.5">
                {THEMES.map((t) => (
                  <button key={t.id} onClick={() => set({ theme: t.id })} className="group grid justify-items-center gap-1">
                    <span
                      className={clsx('size-11 rounded-lg shadow-md transition group-hover:-translate-y-0.5', theme === t.id && 'ring-2 ring-ink ring-offset-2 ring-offset-paper')}
                      style={{ background: t.swatch }}
                    />
                    <span className="text-[10.5px] text-ink-soft">{t.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="paper-panel flex items-center gap-0.5 rounded-2xl px-2 py-1.5">
        <Tool icon={<StickyNote size={19} />} label="Sticky note" onClick={() => addClue('note', { color: '#f7de6b' }, { near: selected })} />
        <Tool icon={<Tag size={19} />} label="Scrap label" onClick={() => addClue('label', { title: '' }, { near: selected })} />
        <Tool icon={<CircleHelp size={19} />} label="Question" onClick={() => addClue('question', { title: 'Why…?' }, { near: selected })} />
        <Tool icon={<Link2 size={19} />} label="Pin a link" onClick={() => toggle('link')} active={open === 'link'} />
        <span className="mx-1 h-6 w-px bg-ink/15" />
        <Tool icon={<Search size={18} />} label="Find on board" onClick={() => toggle('find')} active={open === 'find'} />
        <Tool icon={<LayoutGrid size={19} />} label="Arrange by data" onClick={() => toggle('arrange')} active={open === 'arrange'} />
        <Tool icon={<Palette size={19} />} label="Board surface" onClick={() => toggle('theme')} active={open === 'theme'} />
        <Tool icon={<Maximize size={18} />} label="See everything" onClick={() => void flow()?.fitView({ duration: 700, padding: 0.12 })} />
      </div>
    </div>
  );
}
