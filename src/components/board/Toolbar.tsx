import clsx from 'clsx';
import { BoxSelect, CircleHelp, LayoutGrid, Link2, Maximize, Palette, Plus, Search, Sparkles, StickyNote, Tag } from 'lucide-react';
import { WeavePanel } from './WeavePanel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openTiePicker } from '../../lib/tie';
import type { EntityType } from '../../../shared/types';
import { addClue, pinUrl } from '../../lib/dig';
import { addFiles, addNamedCard, addPlace } from '../../lib/evidence';
import { pinPlace, type FoundPlace } from '../../lib/places';
import { PlacePicker } from '../PlacePicker';
import { flow, viewportCenter } from '../../lib/flow';
import { arrange, ARRANGE_LABEL, untangle, type ArrangeMode } from '../../lib/layout';
import { play } from '../../lib/sound';
import { FRAME_COLORS } from '../../lib/utils';
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
  move(positions, `Re-arranged the board (${ARRANGE_LABEL[mode].toLowerCase()})`);
}

/** Pushes overlapping cards apart, keeping the layout you made otherwise. */
export function spreadOut() {
  const board = currentBoard();
  const movable = new Set(board.nodes.filter((n) => n.type !== 'frame').map((n) => n.id));
  move(untangle(board.nodes, movable, new Map(), 30, 120), 'Spread out the cards');
}

function move(positions: Map<string, { x: number; y: number }>, label: string) {
  if (!positions.size) return;
  const ui = useUi.getState();
  useBoards.getState().snapshot(label);
  ui.set({ arranging: true });
  useBoards.getState().updateNodes((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n));
  play('paper');
  setTimeout(() => {
    useUi.getState().set({ arranging: false });
    void flow()?.fitView({ duration: 700, padding: 0.12 });
  }, 750);
}

function Tool({ icon, label, onClick, active, primary, wide }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; primary?: boolean; /** Only on wider screens (phones reach it through the + menu). */ wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        'group relative size-10 shrink-0 place-items-center rounded-xl transition hover:-translate-y-1 hover:rotate-[-4deg]',
        wide ? 'hidden md:grid' : 'grid',
        primary ? 'bg-[#c8322f] text-white shadow-md hover:bg-[#b02a27]' : 'text-ink hover:bg-paper-2',
        active && !primary && 'bg-paper-2',
      )}
    >
      {icon}
      <span className="tool-tip pointer-events-none absolute -top-8 whitespace-nowrap rounded bg-ink px-2 py-1 text-[11px] text-paper opacity-0 transition group-hover:opacity-100">{label}</span>
    </button>
  );
}

const KINDS: { type: EntityType; label: string; emoji: string; ask: string; eg: string }[] = [
  { type: 'person', label: 'Person', emoji: '🧑', ask: 'Who?', eg: 'Their name' },
  { type: 'place', label: 'Place', emoji: '📍', ask: 'Where?', eg: 'A city, address or landmark' },
  { type: 'event', label: 'Event', emoji: '📅', ask: 'What happened?', eg: 'The name of the event' },
  { type: 'org', label: 'Organisation', emoji: '🏛', ask: 'Which group?', eg: 'The name of the group or company' },
  { type: 'work', label: 'Film, book…', emoji: '🎬', ask: 'Which work?', eg: 'The title' },
  { type: 'object', label: 'Object', emoji: '🗝', ask: 'What thing?', eg: 'What it is called' },
  { type: 'concept', label: 'Idea', emoji: '💡', ask: 'What idea?', eg: 'The idea in a few words' },
];

/** Where new cards go: next to the selected card, else an open spot in the middle of the view. */
const spot = () => {
  const near = useUi.getState().selectedNodeId;
  return near ? { near } : {};
};

/** Build a map card: pick places (by name, address, map link or coordinates), name it, pin it. */
function MapForm({ back, close }: { back: () => void; close: () => void }) {
  const [chosen, setChosen] = useState<FoundPlace[]>([]);
  const [title, setTitle] = useState('');
  const make = () => {
    if (!chosen.length) return;
    const name = title.trim() || chosen.map((p) => p.name).slice(0, 3).join(', ');
    const id = addClue('map', { title: `Map: ${name}`.slice(0, 90), source: 'mine', points: chosen.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name.slice(0, 40), from: 'mine' as const })) }, spot());
    setTimeout(() => useUi.getState().focusNodes([id], true), 250);
    close();
  };
  return (
    <div>
      <button type="button" className="text-[12px] text-ink-soft hover:text-ink" onClick={back}>
        ← All cards
      </button>
      <div className="mt-1 font-hand text-[21px] leading-none">🗺 Which places go on the map?</div>
      <PlacePicker autoFocus onPick={(p) => setChosen((c) => (c.some((x) => x.lat === p.lat && x.lon === p.lon) ? c : [...c, p]))} />
      {chosen.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chosen.map((p, i) => (
            <span key={`${p.lat},${p.lon}`} className="chip !py-0.5 !pr-1">
              📍 {p.name.slice(0, 28)}
              <button type="button" className="ml-1 opacity-60 hover:opacity-100" title="Leave it off" onClick={() => setChosen((c) => c.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the map shows (optional)" className="add-input" />
      <div className="mt-1.5 text-[11.5px] text-ink-soft">Paste a Google, Apple or OpenStreetMap link, type an address, or coordinates. Add as many places as you like.</div>
      <button type="button" disabled={!chosen.length} className="add-go" onClick={make}>
        {chosen.length ? `Pin the map (${chosen.length} place${chosen.length === 1 ? '' : 's'})` : 'Pick a place first'}
      </button>
    </div>
  );
}

function AddPanel({ close }: { close: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number] | null>(null);
  const [mapping, setMapping] = useState(false);
  const [found, setFound] = useState<FoundPlace | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const photo = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);

  const make = async () => {
    const n = name.trim();
    if ((!n && !found) || !kind) return;
    setBusy(true);
    setErr('');
    try {
      // A place picked from the suggestions pins exactly there; a typed name is looked up, else kept as yours.
      if (kind.type === 'place' && found) {
        pinPlace(found, spot(), notes);
      } else if (kind.type === 'place') {
        const id = await addPlace(n, spot()).catch(() => addNamedCard(n, 'place', spot(), notes));
        if (notes.trim()) useBoards.getState().updateNode(id, { text: notes.trim().slice(0, 1200) });
      } else addNamedCard(n, kind.type, spot(), notes);
      setNotes('');
      setName('');
      setFound(null);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const simple = (fn: () => void) => () => {
    fn();
    close();
  };

  if (mapping) return <div className="add-panel"><MapForm back={() => setMapping(false)} close={close} /></div>;
  return (
    <div className="add-panel">
      {kind ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void make();
          }}
        >
          <button type="button" className="text-[12px] text-ink-soft hover:text-ink" onClick={() => setKind(null)}>
            ← All cards
          </button>
          <div className="mt-1 font-hand text-[21px] leading-none">
            {kind.emoji} {kind.ask}
          </div>
          {kind.type === 'place' ? (
            found || name ? (
              <div className="add-input flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">📍 {found ? found.name : name}{found?.full && found.full !== found.name ? <span className="text-ink-soft"> · {found.full}</span> : null}</span>
                <button type="button" className="shrink-0 text-[12px] text-ink-soft hover:text-ink" onClick={() => { setFound(null); setName(''); }}>
                  change
                </button>
              </div>
            ) : (
              <PlacePicker autoFocus onPick={(p) => setFound(p)} onRaw={(t) => setName(t)} rawLabel="Pin it by name only" />
            )
          ) : (
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={kind.eg} className="add-input" />
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you know about it (optional): where it was found, who had it, why it matters…"
            rows={3}
            className="add-input resize-none"
          />
          <div className="mt-1.5 text-[11.5px] text-ink-soft">
            {kind.type === 'place' ? 'Type a place or address, or paste a map link or coordinates, then pick it from the list.' : 'If Wikipedia has a page with exactly this name, its picture and summary are added. Otherwise the card is yours, with your notes.'} Double-click a card to write on it later.
          </div>
          {err && <div className="mt-1 text-[12px] text-[#b3261e]">{err}</div>}
          <button type="submit" disabled={(!name.trim() && !found) || busy} className="add-go">
            {busy ? 'Adding…' : 'Pin it'}
          </button>
        </form>
      ) : (
        <>
          <div className="add-head">Pin your own card</div>
          <div className="add-grid">
            {KINDS.map((k) => (
              <button key={k.type} className="add-tile" onClick={() => setKind(k)}>
                <span className="text-[19px]">{k.emoji}</span>
                {k.label}
              </button>
            ))}
            <button className="add-tile" onClick={simple(() => addClue('quote', { title: 'Who said it', text: '“…”', source: 'mine' }, spot()))}>
              <span className="text-[19px]">❝</span>Quote
            </button>
            <button className="add-tile" onClick={simple(() => addClue('question', { title: 'Why…?' }, spot()))}>
              <span className="text-[19px]">❓</span>Question
            </button>
            <button className="add-tile" onClick={() => setMapping(true)}>
              <span className="text-[19px]">🗺</span>Map
            </button>
            <button
              className="add-tile"
              onClick={simple(() => {
                const from = useUi.getState().selectedNodeId;
                if (from) openTiePicker(from);
                else useUi.getState().set({ toast: { text: 'Drag the 🧶 on the side of a card onto another card to tie them. Or pick the card the string starts from and press String again to choose from a list.', at: Date.now() } });
              })}
            >
              <span className="text-[19px]">🧶</span>String
            </button>
            <button className="add-tile" onClick={simple(() => addClue('label', { title: '' }, spot()))}>
              <span className="text-[19px]">🏷</span>Label
            </button>
            <button className="add-tile" onClick={simple(() => addClue('note', { color: '#f7de6b' }, spot()))}>
              <span className="text-[19px]">🗒</span>Sticky note
            </button>
            <button
              className="add-tile"
              onClick={simple(() => {
                const c = viewportCenter();
                addClue('frame', { title: '', color: FRAME_COLORS[currentBoard().nodes.filter((n) => n.type === 'frame').length % FRAME_COLORS.length] }, { at: c });
              })}
            >
              <span className="text-[19px]">▭</span>Theory frame
            </button>
          </div>
          <div className="add-head mt-3">From your device</div>
          <div className="add-grid">
            <button className="add-tile" onClick={() => photo.current?.click()}>
              <span className="text-[19px]">📷</span>Photos
            </button>
            <button className="add-tile" onClick={() => doc.current?.click()}>
              <span className="text-[19px]">📄</span>PDF or text
            </button>
          </div>
          <div className="mt-2 text-[11.5px] leading-snug text-ink-soft">Or drop files, links and pictures onto the board, or paste them with Ctrl+V.</div>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void addFiles(files, spot());
              close();
            }}
          />
          <input
            ref={doc}
            type="file"
            accept=".pdf,application/pdf,.txt,.md,.csv,text/plain"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void addFiles(files, spot());
              close();
            }}
          />
        </>
      )}
    </div>
  );
}

export function Toolbar() {
  const [open, setOpen] = useState<'add' | 'link' | 'arrange' | 'theme' | 'find' | 'weave' | null>(null);
  const [link, setLink] = useState('');
  const [find, setFind] = useState('');
  const matches =
    open === 'find' && find.trim().length > 1
      ? currentBoard()
          .nodes.filter((n) => `${n.data.title} ${n.data.text ?? ''}`.toLowerCase().includes(find.trim().toLowerCase()))
          .slice(0, 8)
      : [];
  const theme = useSettings((s) => s.theme);
  const snap = useSettings((s) => s.snap);
  const set = useSettings((s) => s.set);
  const selected = useUi((s) => s.selectedNodeId);
  const selecting = useUi((s) => s.selecting);
  const addMenuAt = useUi((s) => s.addMenuAt);
  const toggle = (k: typeof open) => setOpen((o) => (o === k ? null : k));
  useEffect(() => {
    if (addMenuAt) setOpen('add');
  }, [addMenuAt]);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // A file picker or the card menu opened from the panel is still "inside".
      if (!t || bar.current?.contains(t) || t.closest('.paper-panel.fixed')) return;
      setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={bar} className="board-toolbar absolute inset-x-3 bottom-7 z-20 mx-auto w-fit">
      {open && (
        <>
          <div className="toolbar-panel paper-panel animate-rise absolute bottom-[62px] left-1/2 z-10 min-w-[260px] -translate-x-1/2 rounded-xl p-3">
            {open === 'add' && <AddPanel close={() => setOpen(null)} />}
            {open === 'weave' && <WeavePanel close={() => setOpen(null)} />}
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
                <div className="mb-2 font-hand text-[19px] leading-none">Pin a link, image or video</div>
                <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className="add-input !mt-0 w-[320px] max-w-full" />
                <div className="mt-1.5 text-[11px] text-ink-soft">Pages are read for you. Dead links come back from the Wayback Machine.</div>
              </form>
            )}
            {open === 'find' && (
              <div className="w-[320px] max-w-full">
                <div className="mb-2 font-hand text-[19px] leading-none">Find a card on this board</div>
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
                  className="add-input !mt-0 w-full"
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
                <div className="mb-1 font-hand text-[19px] leading-none">Re-pin the board…</div>
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
                <button
                  className="rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-paper-2"
                  onClick={() => {
                    spreadOut();
                    setOpen(null);
                  }}
                >
                  Spread out overlapping cards
                </button>
                <div className="my-1 h-px bg-ink/10" />
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-paper-2">
                  <input type="checkbox" checked={snap} onChange={(e) => set({ snap: e.target.checked })} />
                  Snap cards to a grid when you drag
                </label>
                <div className="px-2.5 text-[11.5px] leading-snug text-ink-soft">Drag any card to move it. To move many at once, turn on “Select many” and draw a box around them.</div>
              </div>
            )}
            {open === 'theme' && (
              <div>
                <div className="mb-2 font-hand text-[19px] leading-none">Board surface</div>
                <div className="flex flex-wrap gap-2.5">
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
                <div className="mt-2 text-[11.5px] text-ink-soft">Right-click (or press and hold) any card for stamps, colours and pin styles.</div>
              </div>
            )}
          </div>
        </>
      )}
      <div className="toolbar-row paper-panel relative z-10 flex items-center gap-0.5 rounded-2xl px-2 py-1.5">
        <Tool icon={<Plus size={20} />} label="Add a card, photo or file" onClick={() => toggle('add')} active={open === 'add'} primary />
        <span className="mx-1 hidden h-6 w-px shrink-0 bg-ink/15 md:block" />
        <Tool icon={<StickyNote size={19} />} label="Sticky note" wide onClick={() => addClue('note', { color: '#f7de6b' }, { near: selected })} />
        <Tool icon={<Tag size={19} />} label="Scrap label" wide onClick={() => addClue('label', { title: '' }, { near: selected })} />
        <Tool icon={<CircleHelp size={19} />} label="Question" wide onClick={() => addClue('question', { title: 'Why…?' }, { near: selected })} />
        <Tool icon={<Link2 size={19} />} label="Pin a link" onClick={() => toggle('link')} active={open === 'link'} />
        <span className="mx-1 h-6 w-px shrink-0 bg-ink/15" />
        <Tool icon={<Sparkles size={19} />} label="Weave this: suggest strings" onClick={() => toggle('weave')} active={open === 'weave'} />
        <Tool icon={<BoxSelect size={19} />} label={selecting ? 'Select many: on (drag a box)' : 'Select many'} onClick={() => useUi.getState().set({ selecting: !selecting })} active={!!selecting} />
        <Tool icon={<Search size={18} />} label="Find on board" onClick={() => toggle('find')} active={open === 'find'} />
        <Tool icon={<LayoutGrid size={19} />} label="Arrange" onClick={() => toggle('arrange')} active={open === 'arrange'} />
        <Tool icon={<Palette size={19} />} label="Board surface" onClick={() => toggle('theme')} active={open === 'theme'} />
        <Tool icon={<Maximize size={18} />} label="See everything" onClick={() => void flow()?.fitView({ duration: 700, padding: 0.12 })} />
      </div>
    </div>
  );
}
