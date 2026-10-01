import { ConnectionMode, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { Check, Copy, ExternalLink, Flag, LoaderCircle, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { COPY_LATER, loadShared, reportBoard } from '../lib/cloud';
import { useAuth } from '../lib/auth';
import { domain, prettyDate } from '../lib/utils';
import { useBoards } from '../store/boards';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import type { Board, ClueNode, StringEdge } from '../types';
import { ViewportSync } from './board/BoardView';
import { nodeTypes } from './board/nodes';
import { edgeTypes } from './board/StringEdge';
import { Logo } from './TopBar';

/** A board someone shared by link: look around, nothing can be changed. */
export function SharedView({ sid, onLeave }: { sid: string; onLeave: () => void }) {
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const [error, setError] = useState('');
  const signedIn = useAuth((s) => s.status === 'off' || s.status === 'signed-in');
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    loadShared(sid)
      .then((b) => setBoard(b))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sid]);

  useEffect(() => {
    if (board) document.title = `${board.name} · Rabbit Hole`;
  }, [board]);

  const makeCopy = () => {
    if (!board) return;
    if (!signedIn) {
      // Copied once they're signed in (see claimSharedCopy in lib/cloud).
      try {
        sessionStorage.setItem(COPY_LATER, sid);
      } catch {
        /* no storage: they can open the link again after signing in */
      }
      onLeave();
      return;
    }
    useBoards.getState().importBoard({ ...board, name: board.name });
    useUi.getState().set({ toast: { text: `“${board.name}” is now on your boards`, at: Date.now() } });
    onLeave();
  };

  return (
    <div className="desk flex h-full flex-col">
      <header className="desk relative z-30 flex min-h-[62px] shrink-0 items-center gap-3 border-b border-black/50 px-3 py-2 shadow-[0_8px_20px_-12px_rgba(0,0,0,.9)] sm:gap-4">
        <button onClick={onLeave} title="Open Rabbit Hole" className="shrink-0">
          <Logo />
        </button>
        <span className="hidden h-6 w-px shrink-0 bg-white/10 sm:block" />
        {board && (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-paper/90">
            <span className="shrink-0 text-[18px]">{board.emoji}</span>
            <span className="truncate text-[14px] font-medium">{board.name}</span>
            <span className="hidden shrink-0 rotate-[-2deg] rounded-sm border border-[#e9a23b]/70 px-1.5 py-0.5 font-type text-[10.5px] uppercase tracking-wider text-[#e9a23b] sm:inline-block">
              view only
            </span>
          </div>
        )}
        {board && (
          <button onClick={() => setReporting(true)} className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg p-2 font-ui text-[12.5px] text-paper/55 hover:bg-white/5 hover:text-paper" title="Report this board">
            <Flag size={14} />
            <span className="hidden md:inline">Report</span>
          </button>
        )}
        {board && (
          <button onClick={makeCopy} className="btn-stamp flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[12.5px] sm:px-3.5">
            <Copy size={13} />
            <span className="sm:hidden">{signedIn ? 'COPY' : 'SIGN IN TO COPY'}</span>
            <span className="hidden sm:inline">{signedIn ? 'MAKE MY OWN COPY' : 'SIGN IN TO MAKE A COPY'}</span>
          </button>
        )}
      </header>
      <main className="relative min-h-0 flex-1">
        {board ? (
          <ReactFlowProvider>
            <ReadOnlyBoard board={board} />
          </ReactFlowProvider>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center font-ui text-paper/80">
            {error ? (
              <div className="max-w-[360px]">
                <div className="font-hand text-[28px] text-paper">Couldn't open this board</div>
                <p className="mt-2 text-[14px] leading-relaxed">{error}</p>
                <button onClick={onLeave} className="btn-stamp mt-4 px-4 py-1.5 text-[13px]">
                  OPEN RABBIT HOLE
                </button>
              </div>
            ) : board === null ? (
              <div className="max-w-[360px]">
                <div className="font-hand text-[28px] text-paper">This board isn't shared any more</div>
                <p className="mt-2 text-[14px] leading-relaxed">Whoever made it turned the link off or deleted the board.</p>
                <button onClick={onLeave} className="btn-stamp mt-4 px-4 py-1.5 text-[13px]">
                  START YOUR OWN
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[14px]">
                <LoaderCircle size={16} className="animate-spin" /> Unpinning the evidence…
              </div>
            )}
          </div>
        )}
      </main>
      {reporting && <ReportModal sid={sid} onClose={() => setReporting(false)} />}
    </div>
  );
}

const FIT = { padding: 0.15, maxZoom: 0.9 };
const ytId = (url?: string) => url?.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/)?.[1];
const KIND_NAMES: Record<string, string> = {
  topic: 'Case file',
  entity: 'Index card',
  note: 'Note',
  image: 'Photo',
  clip: 'Clipping',
  post: 'Post',
  video: 'Video',
  tangent: 'Rabbit hole',
  question: 'Open question',
  quote: 'Quote',
  label: 'Label',
  map: 'Map',
  gallery: 'Gallery',
};

/**
 * Someone else's board. Cards can be moved on this screen to untangle a pile (nothing is
 * saved) and clicked to read; nothing reaches the owner's board.
 */
function ReadOnlyBoard({ board }: { board: Board }) {
  const wrap = useRef<HTMLDivElement>(null);
  const theme = useSettings((s) => s.theme);
  const font = useSettings((s) => s.font);
  const [openId, setOpenId] = useState<string | null>(null);
  const rf = useReactFlow<ClueNode, StringEdge>();
  const open = (id: string | null) => {
    setOpenId(id);
    // Lights the open card's strings, as on your own board.
    useUi.getState().set({ selectedNodeId: id ?? undefined });
  };
  useEffect(() => () => useUi.getState().set({ selectedNodeId: undefined }), []);
  const onNodeClick = useCallback<NodeMouseHandler<ClueNode>>((_, n) => open(n.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const card = openId ? board.nodes.find((n) => n.id === openId) : undefined;
  return (
    <div ref={wrap} className={clsx('board shared-board', `theme-${theme}`, `bfont-${font}`, card && 'has-selection')}>
      {/* Card buttons dig, ask and edit; on someone else's board they'd act on yours. Clicking a card reads it instead. */}
      <style>{`.shared-board .react-flow .clue-actions,.shared-board .react-flow .clue-btn,.shared-board .react-flow .btn-stamp,.shared-board .react-flow__resize-control{display:none!important}.shared-board textarea,.shared-board input{pointer-events:none}.shared-board .react-flow__handle{pointer-events:none}.shared-board .react-flow__node{cursor:pointer}`}</style>
      <ReactFlow<ClueNode, StringEdge>
        defaultNodes={board.nodes}
        defaultEdges={board.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Strings tie pin to pin, as on your own board; without this none of them draw.
        connectionMode={ConnectionMode.Loose}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        elevateNodesOnSelect
        onNodeClick={onNodeClick}
        onPaneClick={() => open(null)}
        zoomOnDoubleClick={false}
        minZoom={0.04}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT}
      >
        <ViewportSync target={wrap} />
        <Controls showInteractive={false} position="bottom-left" style={{ marginLeft: 12, marginBottom: 12 }} />
      </ReactFlow>
      {!card && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-4 py-1.5 font-ui text-[12.5px] text-paper/90 backdrop-blur-sm max-sm:hidden">
          Click a card to read it · drag cards to see what's underneath
        </div>
      )}
      {card && (
        <CardReader
          card={card}
          board={board}
          onClose={() => open(null)}
          onJump={(id) => {
            open(id);
            void rf.fitView({ nodes: [{ id }], duration: 500, padding: 0.5, maxZoom: 1.1 });
          }}
        />
      )}
    </div>
  );
}

/** Everything a card holds, in plain readable text, with its strings and the original source. */
function CardReader({ card, board, onClose, onJump }: { card: ClueNode; board: Board; onClose: () => void; onJump: (id: string) => void }) {
  const d = card.data;
  const yt = ytId(d.url);
  const links = board.edges
    .filter((e) => e.source === card.id || e.target === card.id)
    .map((e) => ({ edge: e, other: board.nodes.find((n) => n.id === (e.source === card.id ? e.target : e.source)) }))
    .filter((l): l is { edge: StringEdge; other: ClueNode } => !!l.other);
  const meta = [d.author, d.date && prettyDate(d.date), d.url ? domain(d.url) : d.source].filter(Boolean).join(' · ');
  return (
    <aside className="paper-panel animate-rise absolute inset-y-3 right-3 z-20 flex w-[min(430px,calc(100%-24px))] flex-col overflow-hidden rounded-xl font-ui text-ink shadow-2xl">
      <div className="flex items-start gap-2 border-b border-ink/10 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="label-caps text-ink-soft">{KIND_NAMES[card.type ?? ''] ?? 'Card'}</div>
          <h2 className="mt-1 text-[19px] font-bold leading-snug">{d.title || 'Untitled'}</h2>
          {meta && <div className="mt-1 text-[12.5px] text-ink-soft">{meta}</div>}
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 hover:bg-ink/10" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {yt ? (
          <div className="aspect-video overflow-hidden rounded bg-black shadow">
            {/* YouTube refuses to play without knowing which site it's on (the page sends no referrer by default). */}
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${yt}`}
              referrerPolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media; picture-in-picture"
              className="h-full w-full"
              allowFullScreen
              title={d.title}
            />
          </div>
        ) : (
          d.image && card.type !== 'map' && <img src={d.image} alt="" className="max-h-[300px] w-full rounded object-cover shadow" />
        )}
        {d.premise && <p className="mt-3 rounded-md bg-[#fff3cd]/80 px-3 py-2 text-[13.5px] leading-relaxed text-[#6b5000]">{d.premise}</p>}
        {d.hook && d.hook !== d.text && <p className="mt-3 text-[15px] italic leading-relaxed text-ink/85">{d.hook}</p>}
        {d.text && <p className="mt-3 whitespace-pre-line text-[15px] leading-[1.7] text-[#2f2620]">{d.text}</p>}
        {d.items?.length ? (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {d.items.slice(0, 30).map((it) => (
              <a key={`${it.title}${it.url}`} href={it.url} target="_blank" rel="noreferrer" className="text-center text-[12px] leading-tight hover:underline">
                {it.image && <img src={it.image} alt="" className="mb-1 aspect-square w-full rounded object-cover" loading="lazy" />}
                {it.title}
              </a>
            ))}
          </div>
        ) : null}
        {d.url && (
          <a href={d.url} target="_blank" rel="noreferrer" className="btn-stamp mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px]">
            <ExternalLink size={13} /> READ THE ORIGINAL
          </a>
        )}
        {links.length > 0 && (
          <>
            <div className="label-caps mt-6 text-ink-soft">Strings · {links.length}</div>
            <div className="mt-1.5 grid gap-1">
              {links.map(({ edge, other }) => (
                <button key={edge.id} onClick={() => onJump(other.id)} className="rounded-md px-2 py-1.5 text-left text-[13.5px] leading-snug hover:bg-ink/5">
                  <span className="font-medium text-teal">{other.data.title || KIND_NAMES[other.type ?? ''] || 'Card'}</span>
                  {edge.data?.label && <span className="text-ink-soft"> — {edge.data.label}</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {d.extras?.length ? (
          <>
            <div className="label-caps mt-6 text-ink-soft">More finds</div>
            <div className="mt-1.5 grid gap-1">
              {d.extras.slice(0, 20).map((x) => (
                <a key={x.id} href={x.url} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1.5 text-[13.5px] leading-snug hover:bg-ink/5">
                  <span className="font-medium text-teal">{x.title}</span>
                  <span className="text-ink-soft"> · {domain(x.url)}</span>
                </a>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

const REASONS = [
  'False or misleading claims about a real person',
  'Harassment or private information about someone',
  'Hateful, violent or sexual content',
  'Spam',
  'Something else',
];

/** Lets anyone flag a shared board; it lands in the owner's report list (admin.reports). */
function ReportModal({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const send = async () => {
    setState('sending');
    setError('');
    try {
      await reportBoard(sid, reason, details);
      setState('sent');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="paper-panel animate-rise relative w-[min(440px,100%)] rounded-xl px-6 pb-6 pt-5 font-ui text-ink">
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1.5 hover:bg-ink/10" aria-label="Close">
          <X size={18} />
        </button>
        {state === 'sent' ? (
          <div className="py-4 text-center">
            <Check size={28} className="mx-auto text-[#2f6b72]" />
            <div className="mt-2 font-hand text-[28px] leading-none">Thanks for telling us</div>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink/80">We'll look at this board and take its link down if it breaks the rules.</p>
          </div>
        ) : (
          <>
            <div className="font-hand text-[28px] leading-none">Report this board</div>
            <p className="mt-2 pr-6 text-[13.5px] leading-relaxed text-ink/80">What's wrong with it?</p>
            <div className="mt-3 grid gap-1.5">
              {REASONS.map((r) => (
                <label key={r} className={clsx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13.5px]', reason === r ? 'border-ink/40 bg-white' : 'border-ink/10 hover:bg-white/60')}>
                  <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Anything we should know? (optional)"
              className="mt-3 w-full resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-[13.5px] outline-none focus:border-ink/40"
            />
            {error && <div className="mt-2 rounded-md bg-[#b3261e]/10 px-3 py-2 text-[12.5px] text-[#8c1d17]">{error}</div>}
            <button onClick={() => void send()} disabled={!reason || state === 'sending'} className="btn-stamp mt-3 px-4 py-2 text-[13px] disabled:opacity-50">
              {state === 'sending' ? 'SENDING…' : 'SEND REPORT'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
