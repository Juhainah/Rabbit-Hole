import clsx from 'clsx';
import { ArrowDown, BookOpen, ExternalLink, History, MessageCircle, Plus, Scissors, Search, Trash2 } from 'lucide-react';
import type { EntityType } from '../../../shared/types';
import { askAbout, pinItem, startDig } from '../../lib/dig';
import { cut, openTiePicker } from '../../lib/tie';
import { ENTITY_COLORS, ENTITY_LABEL, NOTE_COLORS, PIN_COLORS, STRING_COLORS, TYPE_LABEL } from '../../lib/utils';
import { useBoards, useCurrentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueType } from '../../types';
import { SourceBadge } from '../SourceBadge';

const DISPLAY: ClueType[] = ['entity', 'clip', 'image', 'post', 'video', 'quote', 'note', 'question', 'label', 'tangent'];
const CARD_TINTS = [undefined, '#dca83f', '#5f9e6e', '#3f7f86', '#c8322f', '#7e5a9b', '#c85a8a', '#b8743a'];

const field = 'w-full rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink/40';

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mt-3.5 mb-1 label-caps text-ink-soft">{children}</div>;
}

function Swatches({ colors, value, onPick }: { colors: (string | undefined)[]; value?: string; onPick: (c?: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => (
        <button
          key={i}
          onClick={() => onPick(c)}
          className={clsx('size-6 rounded-full shadow-sm ring-1 ring-black/15 transition hover:scale-110', value === c && 'ring-2 ring-ink ring-offset-1')}
          style={{ background: c ?? 'repeating-linear-gradient(45deg,#fff 0 4px,#ddd 4px 8px)' }}
          title={c ?? 'default'}
        />
      ))}
    </div>
  );
}

export function Inspector() {
  const board = useCurrentBoard();
  const nodeId = useUi((s) => s.selectedNodeId);
  const edgeId = useUi((s) => s.selectedEdgeId);
  const s = useBoards.getState();
  const ui = useUi.getState();
  const node = board.nodes.find((n) => n.id === nodeId);
  const edge = board.edges.find((e) => e.id === edgeId);

  if (edge && !node) {
    const a = board.nodes.find((n) => n.id === edge.source);
    const b = board.nodes.find((n) => n.id === edge.target);
    return (
      <div className="px-4 py-4">
        <div className="font-hand text-[26px] leading-none">A piece of string</div>
        <div className="mt-1 text-[13px] text-ink-soft">
          {a?.data.title} ⟷ {b?.data.title}
        </div>
        <Label>Label</Label>
        <input key={edge.id} defaultValue={edge.data?.label} onBlur={(e) => s.updateEdge(edge.id, { label: e.target.value })} placeholder="e.g. paid by, lied about, 02/11" className={field} />
        <Label>Colour</Label>
        <Swatches colors={[undefined, ...STRING_COLORS]} value={edge.data?.color} onPick={(color) => s.updateEdge(edge.id, { color })} />
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={!!edge.data?.dashed} onChange={(e) => s.updateEdge(edge.id, { dashed: e.target.checked })} className="accent-[#c8322f]" /> Dashed (a hunch, not a fact)
        </label>
        <button onClick={() => { s.removeEdge(edge.id); ui.select(); }} className="mt-4 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-[#b3261e] hover:bg-[#b3261e]/10">
          <Trash2 size={14} /> Cut this string
        </button>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="px-6 pt-10 text-center">
        <div className="font-hand text-[26px] leading-none">Pick up a clue</div>
        <p className="mx-auto mt-2 max-w-[280px] text-[13px] leading-relaxed text-ink-soft">
          Click any card or string on the board to edit it: rename it, change how it looks, recolour its pin, or dig deeper from it.
        </p>
      </div>
    );
  }

  const d = node.data;
  const update = (patch: Partial<typeof d>) => s.updateNode(node.id, patch);
  const links = board.edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({ e, other: board.nodes.find((n) => n.id === (e.source === node.id ? e.target : e.source)) }))
    .filter((x) => x.other);

  return (
    <div key={node.id} className="px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="label-caps text-ink-soft">{TYPE_LABEL[node.type as ClueType]}</span>
        <SourceBadge id={d.source} />
      </div>
      {d.image && <img src={d.image} alt="" className="mt-2 max-h-[220px] w-full rounded object-cover shadow" />}

      <Label>Title</Label>
      <input defaultValue={d.title} onBlur={(e) => update({ title: e.target.value })} className={clsx(field, 'font-medium')} />
      <Label>Notes & details</Label>
      <textarea defaultValue={d.text} onBlur={(e) => update({ text: e.target.value })} rows={6} className={clsx(field, 'resize-y leading-relaxed')} />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Date</Label>
          <input defaultValue={d.date} onBlur={(e) => update({ date: e.target.value || undefined })} placeholder="YYYY-MM-DD" className={field} />
        </div>
        <div>
          <Label>Show as</Label>
          <select value={node.type} onChange={(e) => s.updateNodes((n) => (n.id === node.id ? { ...n, type: e.target.value as ClueType } : n))} className={field}>
            {node.type === 'topic' || node.type === 'map' ? <option value={node.type}>{TYPE_LABEL[node.type as ClueType]}</option> : null}
            {DISPLAY.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {node.type === 'entity' && (
        <>
          <Label>Kind of clue</Label>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(ENTITY_LABEL) as EntityType[]).map((t) => (
              <button key={t} onClick={() => update({ entityType: t })} className={clsx('chip !py-0.5 !text-[11.5px]', d.entityType === t && 'on')}>
                <span className="size-2 rounded-full" style={{ background: ENTITY_COLORS[t] }} />
                {ENTITY_LABEL[t]}
              </button>
            ))}
          </div>
        </>
      )}

      <Label>Image URL</Label>
      <input defaultValue={d.image} onBlur={(e) => update({ image: e.target.value || undefined })} placeholder="https://…" className={field} />

      <Label>{node.type === 'note' ? 'Paper' : 'Card tint'}</Label>
      <Swatches colors={node.type === 'note' ? NOTE_COLORS : CARD_TINTS} value={d.color} onPick={(color) => update({ color })} />
      <Label>Pin</Label>
      <Swatches colors={PIN_COLORS} value={d.pin} onPick={(pin) => update({ pin })} />

      {d.url && (
        <>
          <Label>Source</Label>
          <div className="flex flex-wrap gap-1.5">
            <button className="chip" onClick={() => { ui.set({ readerUrl: d.url }); ui.openTab('read'); }}>
              <BookOpen size={13} /> Read here
            </button>
            <a className="chip" href={d.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Open
            </a>
            <a className="chip" href={`https://web.archive.org/web/*/${d.url}`} target="_blank" rel="noreferrer">
              <History size={13} /> Wayback
            </a>
          </div>
        </>
      )}

      {(d.extras?.length ?? 0) > 0 && (
        <>
          <Label>More finds ({d.extras!.length})</Label>
          <p className="mb-1.5 text-[12px] leading-snug text-ink-soft">Good sources that didn't make the board. Pin any you want.</p>
          <div className="grid gap-0.5">
            {d.extras!.map((it) => (
              <div key={it.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-paper-2">
                <SourceBadge id={it.source} />
                <button
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink"
                  title={it.title}
                  onClick={() => it.url && (ui.set({ readerUrl: it.url }), ui.openTab('read'))}
                >
                  {it.title}
                </button>
                <button
                  className="chip shrink-0 !px-2 !py-0.5 !text-[11.5px]"
                  onClick={() => {
                    pinItem(it, { near: node.id });
                    update({ extras: d.extras!.filter((x) => x.id !== it.id) });
                  }}
                >
                  Pin
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <Label>Follow it</Label>
      <div className="flex flex-wrap gap-1.5">
        <button className="btn-stamp flex items-center gap-1 px-3 py-1.5 text-[12px]" onClick={() => void startDig({ query: d.query ?? d.title, parentId: node.id })}>
          <ArrowDown size={13} /> DIG DEEPER
        </button>
        <button className="chip" onClick={() => askAbout(node.id)}>
          <MessageCircle size={13} /> Ask
        </button>
        <button className="chip" onClick={() => { ui.set({ searchPrefill: { q: d.query ?? d.title, at: Date.now() } }); ui.openTab('search'); }}>
          <Search size={13} /> Search
        </button>
      </div>

      <Label>Strings{links.length ? ` (${links.length})` : ''}</Label>
      <div className="grid gap-0.5">
        {links.map(({ e, other }) => (
          <div key={e.id} className="flex items-center gap-1 rounded-md hover:bg-paper-2">
            <button onClick={() => ui.focusNodes([other!.id])} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-[12.5px]" title="Fly to this card">
              <span className="h-0.5 w-4 shrink-0 rounded" style={{ background: e.data?.color ?? '#c8322f' }} />
              {e.data?.label && <span className="shrink-0 font-hand text-[16px] text-[#b3261e]">{e.data.label}</span>}
              <span className="truncate">{other!.data.title || TYPE_LABEL[other!.type as ClueType]}</span>
            </button>
            <button onClick={() => cut(e.id)} className="shrink-0 rounded p-1.5 text-ink-soft hover:bg-[#b3261e]/10 hover:text-[#b3261e]" title="Cut this string" aria-label={`Cut the string to ${other!.data.title}`}>
              <Scissors size={13} />
            </button>
          </div>
        ))}
        {!links.length && <div className="px-2 py-1 text-[12.5px] text-ink-soft">Not tied to anything yet.</div>}
      </div>
      <button className="chip mt-1.5" onClick={() => openTiePicker(node.id)}>
        <Plus size={13} /> Tie to another card…
      </button>
      <div className="mt-1 text-[11.5px] text-ink-soft">Or select this card, then Shift+click another card on the board.</div>

      <button onClick={() => { s.removeNodes([node.id]); ui.select(); }} className="mt-5 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-[#b3261e] hover:bg-[#b3261e]/10">
        <Trash2 size={14} /> Unpin from board
      </button>
    </div>
  );
}
