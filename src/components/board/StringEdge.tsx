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
    lx: 0.25 * sx + 0.5 * cx + 0.25 * tx,
    ly: 0.25 * sy + 0.5 * cy + 0.25 * ty,
  };
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
  const { d, lx, ly } = sagPath(sourceX, sourceY, targetX, targetY);
  const color = data?.color ?? (stringMode === 'red' && kind !== 'tangent' && kind !== 'evidence' ? 'var(--string)' : KIND_VAR[kind]);
  const width = kind === 'evidence' ? 1.5 : kind === 'tangent' ? 2.2 : 2.6;
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
      {(editing || selected || (showLabels && data?.label)) && (
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
              showLabels &&
              data?.label && (
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
