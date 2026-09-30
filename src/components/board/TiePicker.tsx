import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { retie, tie, tiedEdge } from '../../lib/tie';
import { TYPE_COLORS, TYPE_LABEL } from '../../lib/utils';
import { currentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueNode, ClueType } from '../../types';

const title = (n?: ClueNode) => (n ? n.data.title || TYPE_LABEL[n.type as ClueType] : '');

/**
 * Pick a card to tie to. For an existing string, first choose which end stays
 * put, then pick the card its other end should move to.
 */
export function TiePicker() {
  const picker = useUi((s) => s.tiePicker);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [keep, setKeep] = useState<string>();
  const list = useRef<HTMLDivElement>(null);

  const board = currentBoard();
  const edge = picker?.edgeId ? board.edges.find((e) => e.id === picker.edgeId) : undefined;
  const anchor = edge ? (keep ?? picker!.from) : picker?.from;
  const from = board.nodes.find((n) => n.id === anchor);

  useEffect(() => {
    setQ('');
    setActive(0);
    setKeep(picker?.edgeId ? picker.from : undefined);
  }, [picker]);

  const candidates = useMemo(() => {
    if (!from) return [];
    const needle = q.trim().toLowerCase();
    const caseOf = (n: ClueNode) => n.data.clusterId;
    return board.nodes
      .filter((n) => n.id !== from.id && n.type !== 'map' && (!needle || `${n.data.title} ${n.data.text ?? ''}`.toLowerCase().includes(needle)))
      .sort((a, b) => Number(caseOf(b) === caseOf(from)) - Number(caseOf(a) === caseOf(from)) || title(a).localeCompare(title(b)))
      .slice(0, 60);
    // Recomputed when the query or the anchor changes; board edits don't matter while it's open.
  }, [q, from?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!picker || !from) return null;
  const close = () => useUi.getState().set({ tiePicker: undefined });
  const pick = (n: ClueNode) => {
    if (edge) retie(edge.id, from.id, n.id);
    else {
      const id = tie(from.id, n.id);
      if (id) useUi.getState().set({ selectedEdgeId: id, selectedNodeId: undefined });
    }
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(candidates.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      list.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && candidates[active]) pick(candidates[active]);
  };
  const ends = edge ? [edge.source, edge.target].map((id) => board.nodes.find((n) => n.id === id)!) : [];

  return (
    <div className="fixed inset-0 z-[65] bg-black/30" onMouseDown={close}>
      <div
        role="dialog"
        aria-label={edge ? 'Move a string' : 'Tie to another card'}
        className="paper-panel animate-rise absolute top-[14vh] left-1/2 flex max-h-[68vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 flex-col rounded-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink/10 px-4 pt-4 pb-3">
          <div className="font-hand text-[24px] leading-none">{edge ? 'Move this string' : 'Tie it to…'}</div>
          {edge ? (
            <div className="mt-2.5">
              <div className="mb-1 font-ui text-[12px] text-ink-soft">Keep this end pinned:</div>
              <div className="flex gap-1.5">
                {ends.map((n) => (
                  <button key={n.id} onClick={() => setKeep(n.id)} className={clsx('chip max-w-[50%] !text-[12.5px]', keep === n.id && 'on')}>
                    <span className="truncate">{title(n)}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 font-ui text-[12px] text-ink-soft">…and move the other end to:</div>
            </div>
          ) : (
            <div className="mt-1 truncate font-ui text-[13px] text-ink-soft">
              From <b className="text-ink">{title(from)}</b>. Pick the card it connects to.
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2">
            <Search size={15} className="text-ink-soft" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder="Search the board…"
              className="min-w-0 flex-1 bg-transparent font-ui text-[14px] outline-none placeholder:text-ink/40"
            />
          </label>
        </div>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {candidates.map((n, i) => {
            const already = !!tiedEdge(from.id, n.id);
            return (
              <button
                key={n.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(n)}
                className={clsx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-ui text-[13.5px]', i === active && 'bg-paper-2', already && 'opacity-50')}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: TYPE_COLORS[n.type as ClueType] }} />
                <span className="min-w-0 flex-1 truncate text-ink">{title(n)}</span>
                <span className="shrink-0 text-[11.5px] text-ink-soft">{already ? 'already tied' : TYPE_LABEL[n.type as ClueType]}</span>
              </button>
            );
          })}
          {!candidates.length && <div className="px-3 py-6 text-center font-ui text-[13px] text-ink-soft">No card matches “{q}”.</div>}
        </div>
        <div className="border-t border-ink/10 px-4 py-2 font-ui text-[11.5px] text-ink-soft">↑↓ to choose · Enter to tie · Esc to cancel · Tip: select a card, then Shift+click another to tie them</div>
      </div>
    </div>
  );
}
