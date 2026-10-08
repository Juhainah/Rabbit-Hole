import { Handle, Position } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { hash01, layoutTiles } from '../../lib/utils';
import type { MapPoint } from '../../types';

/** A wobbly red marker circle, like someone circled it with a pen. */
function scribble(cx: number, cy: number, r: number, seed: number) {
  const pts: string[] = [];
  const steps = 30;
  const start = seed * Math.PI * 2;
  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * Math.PI * 2 * 1.12;
    const rr = r * (1 + 0.09 * Math.sin(t * 3 + seed * 11));
    pts.push(`${(cx + Math.cos(t) * rr * 1.18).toFixed(1)},${(cy + Math.sin(t) * rr * 0.86).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}

interface Props {
  points: MapPoint[];
  width: number;
  height: number;
  labels?: boolean;
  handles?: boolean;
  className?: string;
}

/** Static tile map (no map engine per card), with pen marks and optional string anchors. */
export const StaticMap = memo(function StaticMap({ points, width, height, labels = true, handles = false, className }: Props) {
  const layout = useMemo(() => layoutTiles(points, width, height, points.length === 1 ? 6 : 11), [points, width, height]);
  return (
    <div className={className ?? 'mini-map'} style={{ width, height, position: 'relative' }}>
      {layout.tiles.map((t) => (
        <img
          key={t.key}
          src={t.src}
          alt=""
          style={{ left: t.left, top: t.top }}
          loading="lazy"
          draggable={false}
          // A tile that fails to load (a blank strip on the card) comes from the street map instead, then a retry.
          onError={(e) => {
            const img = e.currentTarget;
            const tries = Number(img.dataset.tries ?? 0);
            if (tries >= 2) return;
            img.dataset.tries = String(tries + 1);
            img.src = tries === 0 ? t.src.replace('NatGeo_World_Map', 'World_Street_Map') : `${t.src}${t.src.includes('?') ? '&' : '?'}r=${Date.now()}`;
          }}
        />
      ))}
      <svg width={width} height={height} className="absolute inset-0 overflow-visible pointer-events-none">
        {points.map((p, i) => {
          const { x, y } = layout.project(p.lat, p.lon);
          const seed = hash01(`${p.label}${i}`);
          return (
            <g key={i}>
              {p.mark === 'x' ? (
                <path
                  d={`M${x - 10},${y - 9} L${x + 10},${y + 9} M${x + 10},${y - 10} L${x - 9},${y + 10}`}
                  stroke="#c8322f"
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : (
                <>
                  <circle cx={x} cy={y} r={3.2} fill="#c8322f" />
                  <path d={scribble(x, y, 14, seed)} stroke="#c8322f" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
              {labels && p.label && (() => {
                // Flip the label to the left of the mark when it would run off the map.
                const room = width - x - 22;
                const fitsRight = room > p.label.length * 8.5;
                return (
                  <text x={fitsRight ? x + 18 : x - 18} y={y + (seed > 0.5 ? -12 : 22)} textAnchor={fitsRight ? 'start' : 'end'} className="map-mark-label">
                    {p.label}
                  </text>
                );
              })()}
            </g>
          );
        })}
      </svg>
      {handles &&
        points.map((p, i) => {
          const { x, y } = layout.project(p.lat, p.lon);
          return <Handle key={i} id={`pt-${i}`} type="source" position={Position.Top} className="map-point" style={{ left: x, top: y }} />;
        })}
    </div>
  );
});
