import { EdgeLabelRenderer, useStore, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';
import clsx from 'clsx';
import { Pencil, Scissors, Shuffle } from 'lucide-react';
import { useMemo } from 'react';
import { cut, openTiePicker } from '../../lib/tie';
import { hash01 } from '../../lib/utils';
import { useBoards } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { StringEdge as StringEdgeType } from '../../types';

/** Red yarn that sags under its own weight between two pins. */
function sagPath(sx: number, sy: number, tx: number, ty: number) {
  const dist = Math.hypot(tx - sx, ty - sy);
  const sag = Math.min(150, dist * 0.13) + 8;
  const cx = (sx + tx) / 2;
  const cy = (sy + ty) / 2 + sag;
  return {
    d: `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`,
    cx,
    cy,
    lx: 0.25 * sx + 0.5 * cx + 0.25 * tx,
    ly: 0.25 * sy + 0.5 * cy + 0.25 * ty,
  };
}

/** A point along the sagging string, 0 at one pin and 1 at the other. */
const along = (t: number, sx: number, sy: number, cx: number, cy: number, tx: number, ty: number) => ({
  x: (1 - t) ** 2 * sx + 2 * (1 - t) * t * cx + t ** 2 * tx,
  y: (1 - t) ** 2 * sy + 2 * (1 - t) * t * cy + t ** 2 * ty,
});

// Where a label may sit, middle first.
const SPOTS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.19, 0.81];

type Lookup = Map<string, { type?: string; hidden?: boolean; measured?: { width?: number; height?: number }; internals: { positionAbsolute: { x: number; y: number } } }>;

/**
 * The spot on a string where its label can be read: on the string itself, not over a card.
 * Strings run behind cards, so a label at the middle could float over a card, cut off from
 * its string. Returns -1 when the whole string is hidden behind cards.
 */
function clearSpot(lookup: Lookup, sx: number, sy: number, cx: number, cy: number, tx: number, ty: number): number {
  const pad = 16;
  const minX = Math.min(sx, tx, cx) - pad;
  const maxX = Math.max(sx, tx, cx) + pad;
  const minY = Math.min(sy, ty, cy) - pad;
  const maxY = Math.max(sy, ty, cy) + pad;
  const boxes: [number, number, number, number][] = [];
  for (const n of lookup.values()) {
    if (n.hidden || n.type === 'frame') continue;
    const w = n.measured?.width ?? 0;
    const h = n.measured?.height ?? 0;
    const { x, y } = n.internals.positionAbsolute;
    if (!w || x > maxX || x + w < minX || y > maxY || y + h < minY) continue;
    boxes.push([x - pad, y - pad, x + w + pad, y + h + pad]);
  }
  for (const t of SPOTS) {
    const p = along(t, sx, sy, cx, cy, tx, ty);
    if (!boxes.some(([a, b, c, d]) => p.x > a && p.x < c && p.y > b && p.y < d)) return t;
  }
  return -1;
}

/** Keeps controls a readable size however far the board is zoomed out. */
function Unzoomed({ children }: { children: React.ReactNode }) {
  const zoom = useStore((s) => s.transform[2]);
  return <div style={{ transform: `scale(${Math.min(4, Math.max(1, 1 / zoom))})`, transformOrigin: 'top center' }}>{children}</div>;
}

const KIND_VAR = { evidence: 'var(--string-evidence)', tangent: 'var(--string-tangent)', relation: 'var(--string)', user: 'var(--string)' };

export function StringEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<StringEdgeType>) {
  const showLabels = useSettings((s) => s.showLabels);
  const editing = useUi((s) => s.labelEdit === id);
  // Strings on the selected card stay bright; the rest dim so its connections read clearly.
  const lit = useUi((s) => s.selectedNodeId === source || s.selectedNodeId === target);
  const stringMode = useSettings((s) => s.stringMode);
  const kind = data?.kind ?? 'user';
  const { d, cx, cy } = sagPath(sourceX, sourceY, targetX, targetY);
  // Only labelled strings look for a clear spot, and only re-render when that spot changes.
  const labelled = showLabels && !!data?.label;
  const spot = useStore((s) => (labelled ? clearSpot(s.nodeLookup as unknown as Lookup, sourceX, sourceY, cx, cy, targetX, targetY) : 0.5));
  const { x: lx, y: ly } = along(spot < 0 ? 0.5 : spot, sourceX, sourceY, cx, cy, targetX, targetY);
  // A string hidden behind cards end to end shows its label only when you pick it or its card.
  const labelVisible = labelled && (spot >= 0 || selected || lit);
  const color = data?.color ?? (stringMode === 'red' && kind !== 'tangent' && kind !== 'evidence' ? 'var(--string)' : KIND_VAR[kind]);
  const width = data?.width ?? (kind === 'evidence' ? 1.5 : kind === 'tangent' ? 2.2 : 2.6);
  const rot = useMemo(() => (hash01(id) * 2 - 1) * 5, [id]);
  const dashed = data?.dashed;
  return (
    <>
      <path d={d} className={clsx('string-shadow', lit && 'lit')} />
      <path
        d={d}
        pathLength={dashed ? undefined : 1}
        className={clsx('string-path', !dashed && 'draw', dashed && 'string-flow', lit && 'lit')}
        style={{ stroke: color, strokeWidth: width, strokeDasharray: dashed ? '9 5' : undefined }}
      />
      <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="react-flow__edge-interaction" />
      <circle cx={sourceX} cy={sourceY} r={selected ? 4 : 2.6} fill={color} />
      <circle cx={targetX} cy={targetY} r={selected ? 4 : 2.6} fill={color} />
      {(editing || selected || labelVisible) && (
        <EdgeLabelRenderer>
          <div className="string-ui nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {editing ? (
              <Unzoomed>
              <input
                autoFocus
                defaultValue={data?.label}
                placeholder="paid by, lied about, 02/11…"
                className="string-label-input"
                onBlur={(e) => {
                  useBoards.getState().updateEdge(id, { label: e.target.value.trim() || undefined });
                  useUi.getState().set({ labelEdit: undefined });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') useUi.getState().set({ labelEdit: undefined });
                }}
              />
              </Unzoomed>
            ) : (
              labelVisible && (
                <div className="string-label" style={{ transform: `rotate(${rot}deg)` }} onDoubleClick={() => useUi.getState().set({ labelEdit: id })} title="Double-click to edit">
                  {data.label}
                </div>
              )
            )}
            {selected && !editing && (
              <Unzoomed>
              <div className="string-tools" role="toolbar" aria-label="String">
                <button onClick={() => useUi.getState().set({ labelEdit: id })}>
                  <Pencil size={13} /> {data?.label ? 'Rename' : 'Label'}
                </button>
                <button onClick={() => openTiePicker(source, id)}>
                  <Shuffle size={13} /> Retie
                </button>
                <button className="danger" onClick={() => cut(id)}>
                  <Scissors size={13} /> Cut
                </button>
              </div>
              </Unzoomed>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export function StringConnectionLine({ fromX, fromY, toX, toY }: ConnectionLineComponentProps) {
  const { d } = sagPath(fromX, fromY, toX, toY);
  return (
    <g>
      <path d={d} fill="none" stroke="var(--string)" strokeWidth={2.6} strokeLinecap="round" />
      <circle cx={toX} cy={toY} r={5} fill="var(--string)" />
    </g>
  );
}

export const edgeTypes = { string: StringEdge };
