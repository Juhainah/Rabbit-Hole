import { useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { askAbout, startDig } from '../../lib/dig';
import { cut, cutAll, openTiePicker } from '../../lib/tie';
import { FRAME_COLORS, PIN_COLORS, STAMPS, STRING_COLORS, TINTS, TYPE_LABEL } from '../../lib/utils';
import { useBoards } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueType, PinStyle } from '../../types';

const PIN_STYLES: { id: PinStyle; label: string }[] = [
  { id: 'pin', label: 'Pin' },
  { id: 'tack', label: 'Tack' },
  { id: 'tape', label: 'Tape' },
  { id: 'clip', label: 'Clip' },
];
const THICKNESS = [
  { w: 1.4, label: 'Thin' },
  { w: 2.6, label: 'Normal' },
  { w: 4.2, label: 'Thick' },
];
const Heading = ({ children }: { children: React.ReactNode }) => <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-ink-soft">{children}</div>;

const RESTYLE: ClueType[] = ['entity', 'clip', 'image', 'note', 'post', 'quote', 'question', 'label'];

function Item({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={() => {
        onClick();
        useUi.getState().set({ menu: undefined });
      }}
      className={`block w-full rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-paper-2 ${danger ? 'text-[#b3261e]' : ''}`}
    >
      {children}
    </button>
  );
}

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  // A press-and-hold ends with a tap at the same spot; that tap must not close the menu it just opened.
  const openedAt = useRef(0);
  useEffect(() => {
    if (menu) openedAt.current = Date.now();
  }, [menu]);
  const dismiss = () => {
    if (Date.now() - openedAt.current > 450) useUi.getState().set({ menu: undefined });
  };
  const node = useBoards((s) => (menu?.nodeId ? s.boards[s.currentId]?.nodes.find((n) => n.id === menu.nodeId) : undefined));
  const edge = useBoards((s) => (menu?.edgeId ? s.boards[s.currentId]?.edges.find((e) => e.id === menu.edgeId) : undefined));
  const strings = useBoards((s) => (menu?.nodeId ? (s.boards[s.currentId]?.edges.filter((e) => e.source === menu.nodeId || e.target === menu.nodeId).length ?? 0) : 0));

  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && useUi.getState().set({ menu: undefined });
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);

  if (!menu || (!node && !edge)) return null;
  const s = useBoards.getState();
  const ui = useUi.getState();
  const phone = window.innerWidth < 768;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 240));
  // The menu starts at the click, but never runs off the screen: it scrolls instead.
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 320));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={dismiss} onContextMenu={(e) => { e.preventDefault(); dismiss(); }} />
      <div className="paper-panel animate-rise fixed z-50 w-[232px] overflow-y-auto overscroll-contain rounded-xl p-1.5" style={phone ? { left: 8, right: 8, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', width: 'auto', maxHeight: '62dvh' } : { left, top, maxHeight: `calc(100dvh - ${top + 8}px)` }}>
        {node?.type === 'frame' && (
          <>
            <div className="px-2.5 pt-1 pb-1.5 font-hand text-[18px] leading-tight truncate">{node.data.title || 'Theory frame'}</div>
            <Heading>Frame colour</Heading>
            <div className="flex gap-1.5 px-2.5 pb-2">
              {FRAME_COLORS.map((c) => (
                <button key={c} onClick={() => s.updateNode(node.id, { color: c })} className="size-5 rounded-full shadow ring-1 ring-black/20 transition hover:scale-125" style={{ background: c }} />
              ))}
            </div>
            <Item onClick={() => ui.openTab('inspect')}>✎ Rename or add a note</Item>
            <Item danger onClick={() => { s.removeNodes([node.id]); ui.select(); }}>
              ✕ Remove the frame (cards stay)
            </Item>
          </>
        )}
        {node && node.type !== 'frame' && (
          <>
            <div className="px-2.5 pt-1 pb-1.5 font-hand text-[18px] leading-tight truncate">{node.data.title || TYPE_LABEL[node.type as ClueType]}</div>
            {node.type !== 'note' && node.type !== 'label' && (
              <Item onClick={() => startDig({ query: node.data.query ?? node.data.title, parentId: node.id })}>⛏ Dig deeper</Item>
            )}
            <Item onClick={() => askAbout(node.id)}>
              💬 Ask partner
            </Item>
            <Item onClick={() => { ui.set({ searchPrefill: { q: node.data.query ?? node.data.title, at: Date.now() } }); ui.openTab('search'); }}>
              🔎 Search the archives
            </Item>
            {node.data.url && <Item onClick={() => { ui.set({ readerUrl: node.data.url }); ui.openTab('read'); }}>📖 Read source</Item>}
            {node.data.url && <Item onClick={() => window.open(node.data.url, '_blank', 'noopener')}>↗ Open original</Item>}
            <Item onClick={() => ui.openTab('inspect')}>✎ Edit card</Item>
            <div className="my-1 h-px bg-ink/10" />
            <Item onClick={() => openTiePicker(node.id)}>🧶 Tie to another card…</Item>
            {strings > 0 && <Item onClick={() => cutAll(node.id)}>✂ Cut its strings ({strings})</Item>}
            <div className="my-1 h-px bg-ink/10" />
            <div className="px-2.5 py-1 text-[11px] uppercase tracking-wider text-ink-soft">Show as</div>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {RESTYLE.map((t) => (
                <button
                  key={t}
                  onClick={() => { s.updateNodes((n) => (n.id === node.id ? { ...n, type: t } : n)); ui.set({ menu: undefined }); }}
                  className={`chip !px-2 !py-0.5 !text-[11px] ${node.type === t ? 'on' : ''}`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <Heading>Stamp</Heading>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {STAMPS.map((st) => (
                <button
                  key={st.id}
                  onClick={() => { s.snapshot(`Stamped “${node.data.title}”`); s.updateNode(node.id, { stamp: node.data.stamp === st.id ? undefined : st.id }); }}
                  className="stamp-chip"
                  style={{ '--stamp': st.color, opacity: node.data.stamp && node.data.stamp !== st.id ? 0.55 : 1 } as React.CSSProperties}
                >
                  {node.data.stamp === st.id ? '✓ ' : ''}
                  {st.label}
                </button>
              ))}
              {node.data.stamp && (
                <button
                  onClick={() => { s.snapshot(`Removed the stamp from “${node.data.title}”`); s.updateNode(node.id, { stamp: undefined }); }}
                  className="chip !px-2 !py-0.5 !text-[11px]"
                >
                  ✕ Remove stamp
                </button>
              )}
            </div>
            <Heading>Colour band</Heading>
            <div className="flex items-center gap-1.5 px-2.5 pb-2">
              {TINTS.map((c) => (
                <button key={c} onClick={() => s.updateNode(node.id, { tint: c })} className="size-5 rounded-[4px] shadow ring-1 ring-black/20 transition hover:scale-125" style={{ background: c }} />
              ))}
              {node.data.tint && (
                <button onClick={() => s.updateNode(node.id, { tint: undefined })} className="ml-1 text-[11px] text-ink-soft hover:text-ink">
                  none
                </button>
              )}
            </div>
            <Heading>Pin</Heading>
            <div className="flex gap-1.5 px-2.5 pb-1.5">
              {PIN_COLORS.map((c) => (
                <button key={c} onClick={() => s.updateNode(node.id, { pin: c })} className="size-5 rounded-full shadow ring-1 ring-black/20 transition hover:scale-125" style={{ background: c }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-1 px-2 pb-2">
              {PIN_STYLES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => s.updateNode(node.id, { pinStyle: p.id === 'pin' ? undefined : p.id })}
                  className={`chip !px-2 !py-0.5 !text-[11px] ${(node.data.pinStyle ?? 'pin') === p.id ? 'on' : ''}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="my-1 h-px bg-ink/10" />
            <Item
              onClick={() => {
                const copy = { ...node, id: `${node.type?.slice(0, 2)}-${nanoid(8)}`, position: { x: node.position.x + 40, y: node.position.y + 40 }, selected: false };
                s.addNodes([copy]);
              }}
            >
              ⧉ Duplicate
            </Item>
            <Item danger onClick={() => { s.removeNodes([node.id]); ui.select(); }}>
              ✕ Unpin from board
            </Item>
          </>
        )}
        {edge && (
          <>
            <div className="px-2.5 pt-1 pb-1.5 font-hand text-[18px]">String</div>
            <Item onClick={() => ui.set({ labelEdit: edge.id, selectedEdgeId: edge.id })}>✎ {edge.data?.label ? 'Rename the label' : 'Write a label'}</Item>
            <Item onClick={() => openTiePicker(edge.source, edge.id)}>↔ Move one end…</Item>
            <Item onClick={() => s.updateEdge(edge.id, { dashed: !edge.data?.dashed })}>{edge.data?.dashed ? '— Solid' : '- - Dashed'}</Item>
            <div className="flex gap-1 px-2 pt-1">
              {THICKNESS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => s.updateEdge(edge.id, { width: t.w })}
                  className={`chip !px-2 !py-0.5 !text-[11px] ${Math.abs((edge.data?.width ?? 2.6) - t.w) < 0.3 ? 'on' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 px-2.5 py-2">
              {STRING_COLORS.map((c) => (
                <button key={c} onClick={() => s.updateEdge(edge.id, { color: c })} className="size-5 rounded-full shadow ring-1 ring-black/20 transition hover:scale-125" style={{ background: c }} />
              ))}
            </div>
            <Item danger onClick={() => cut(edge.id)}>✂ Cut string</Item>
          </>
        )}
      </div>
    </>
  );
}

