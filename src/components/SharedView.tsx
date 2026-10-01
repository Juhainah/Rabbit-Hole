import { Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { Copy, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { COPY_LATER, loadShared } from '../lib/cloud';
import { useAuth } from '../lib/auth';
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
      <header className="desk relative z-30 flex min-h-[62px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/50 px-3 py-2 shadow-[0_8px_20px_-12px_rgba(0,0,0,.9)]">
        <button onClick={onLeave} title="Open Rabbit Hole">
          <Logo />
        </button>
        <span className="hidden h-6 w-px bg-white/10 sm:block" />
        {board && (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-paper/90">
            <span className="text-[18px]">{board.emoji}</span>
            <span className="truncate text-[14px] font-medium">{board.name}</span>
            <span className="shrink-0 rotate-[-2deg] rounded-sm border border-[#e9a23b]/70 px-1.5 py-0.5 font-type text-[10.5px] uppercase tracking-wider text-[#e9a23b]">view only</span>
          </div>
        )}
        {board && (
          <button onClick={makeCopy} className="btn-stamp ml-auto flex shrink-0 items-center gap-1.5 px-3.5 py-1.5 text-[12.5px]">
            <Copy size={13} /> {signedIn ? 'MAKE MY OWN COPY' : 'SIGN IN TO MAKE A COPY'}
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
    </div>
  );
}

const FIT = { padding: 0.15, maxZoom: 0.9 };

function ReadOnlyBoard({ board }: { board: Board }) {
  const wrap = useRef<HTMLDivElement>(null);
  const theme = useSettings((s) => s.theme);
  const font = useSettings((s) => s.font);
  return (
    <div ref={wrap} className={clsx('board shared-board', `theme-${theme}`, `bfont-${font}`)}>
      {/* Card buttons dig, ask and edit; on someone else's board they'd act on yours. */}
      <style>{`.shared-board .clue-actions,.shared-board .clue-btn,.shared-board .btn-stamp,.shared-board .react-flow__handle{display:none!important}.shared-board textarea,.shared-board input{pointer-events:none}`}</style>
      <ReactFlow<ClueNode, StringEdge>
        defaultNodes={board.nodes}
        defaultEdges={board.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.04}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT}
      >
        <ViewportSync target={wrap} />
        <Controls showInteractive={false} position="bottom-left" style={{ marginLeft: 12, marginBottom: 12 }} />
      </ReactFlow>
    </div>
  );
}
