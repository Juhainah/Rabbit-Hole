import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { makeEdge } from '../../lib/factory';
import { play } from '../../lib/sound';
import { TYPE_LABEL } from '../../lib/utils';
import { currentBoard, useBoards } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueType } from '../../types';

type Link = { a: string; b: string; label: string; why: string };

/**
 * "Weave this": the partner reads the cards (or the ones you selected) and suggests strings
 * between the ones that are connected. You tie or dismiss each.
 */
export function WeavePanel({ close }: { close: () => void }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState('');

  useEffect(() => {
    const board = currentBoard();
    const picked = board.nodes.filter((n) => n.selected && n.type !== 'frame');
    const pool = (picked.length >= 2 ? picked : board.nodes).filter((n) => n.data.title && !['frame', 'label', 'map'].includes(String(n.type)));
    setScope(picked.length >= 2 ? `the ${picked.length} cards you selected` : `all ${pool.length} cards`);
    if (pool.length < 2) {
      setLinks([]);
      return;
    }
    const cards = pool.map((n) => ({ id: n.id, title: n.data.title, text: n.data.text ?? n.data.hook, kind: TYPE_LABEL[n.type as ClueType] }));
    const tied = board.edges.map((e) => [e.source, e.target] as [string, string]);
    api
      .weave(cards, tied)
      .then(setLinks)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const title = (id: string) => currentBoard().nodes.find((n) => n.id === id)?.data.title ?? '(gone)';
  const tie = (l: Link) => {
    const s = useBoards.getState();
    if (!s.boards[s.currentId]?.nodes.some((n) => n.id === l.a) || !s.boards[s.currentId]?.nodes.some((n) => n.id === l.b)) return;
    s.snapshot(`Tied “${title(l.a)}” to “${title(l.b)}”`);
    s.addEdges([makeEdge(l.a, l.b, { kind: 'user', label: l.label })]);
    play('string');
  };
  const drop = (l: Link) => setLinks((ls) => (ls ?? []).filter((x) => x !== l));

  return (
    <div className="weave-panel">
      <div className="mb-1 font-hand text-[21px] leading-none">Weave this</div>
      <div className="mb-2 text-[12px] text-ink-soft">Strings the partner suggests between {scope || 'your cards'}, from what the cards say. Tie the ones that are right.</div>
      {err && <div className="text-[12.5px] text-[#b3261e]">{err}</div>}
      {!links && !err && <div className="shovel-dots py-3 text-[13px] text-ink-soft">Reading your cards</div>}
      {links && !links.length && !err && <div className="py-2 text-[13px] text-ink-soft">No new connections stand out. Add a few more cards or notes and try again.</div>}
      <div className="grid max-h-[46vh] grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto overflow-x-hidden pr-1">
        {links?.map((l) => (
          <div key={`${l.a}-${l.b}`} className="weave-row">
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => useUi.getState().focusNodes([l.a, l.b])}
              title="Show these two cards"
            >
              <div className="line-clamp-2 break-words text-[13px] font-semibold leading-snug">
                {title(l.a)} <span className="font-normal text-[#c8322f]">— {l.label} —</span> {title(l.b)}
              </div>
              {l.why && <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-soft">{l.why}</div>}
            </button>
            <button
              className="weave-yes"
              title="Tie this string"
              onClick={() => {
                tie(l);
                drop(l);
              }}
            >
              <Check size={15} />
            </button>
            <button className="weave-no" title="Dismiss" onClick={() => drop(l)}>
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      {links && links.length > 1 && (
        <button
          className="add-go"
          onClick={() => {
            links.forEach(tie);
            setLinks([]);
            close();
          }}
        >
          Tie all {links.length}
        </button>
      )}
    </div>
  );
}
