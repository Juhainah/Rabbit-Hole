import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { ENTITY_COLORS, ENTITY_LABEL, nodeColor, TYPE_LABEL } from '../../lib/utils';
import { useCurrentBoard } from '../../store/boards';
import { useUi } from '../../store/ui';
import type { ClueType } from '../../types';

type GNode = { id: string; title: string; color: string; type: ClueType; deg: number };
type GLink = { source: string; target: string; kind?: string };

/** Obsidian-style force graph of every clue and string on the board. */
export function GraphView() {
  const board = useCurrentBoard();
  const selected = useUi((s) => s.selectedNodeId);
  const ref = useRef<ForceGraphMethods<NodeObject<GNode>, LinkObject<GNode, GLink>> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebuild only when the graph's shape changes, not when cards are dragged.
  const shape = board.nodes.map((n) => `${n.id}:${n.type}:${n.data.title}:${n.data.color ?? ''}`).join('|') + board.edges.map((e) => e.id).join('|');
  const data = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of board.edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const ids = new Set(board.nodes.map((n) => n.id));
    return {
      nodes: board.nodes.map((n) => ({ id: n.id, title: n.data.title || TYPE_LABEL[n.type as ClueType], color: nodeColor(n), type: n.type as ClueType, deg: deg.get(n.id) ?? 0 })),
      // A string whose card is gone would stop the whole web from drawing.
      links: board.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.data?.kind })),
    };
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of board.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [board.edges]);

  // Spread the web out so clusters breathe, then frame it once it settles.
  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    // Local repulsion only, so separate cases stay near each other instead of drifting off.
    g.d3Force('charge')?.strength(-130).distanceMax(380);
    g.d3Force('link')?.distance(62);
    g.d3ReheatSimulation();
    const t = setTimeout(() => g.zoomToFit(700, 70), 1800);
    return () => clearTimeout(t);
  }, [data]);

  const focus = hover ?? selected ?? null;
  const lit = (id: string) => !focus || id === focus || neighbors.get(focus)?.has(id);
  const idOf = (x: string | NodeObject<GNode> | undefined) => (typeof x === 'object' ? String(x?.id) : String(x));

  return (
    <div ref={box} className="relative h-full w-full bg-[radial-gradient(1200px_800px_at_50%_40%,#17161f,#09090c)]">
      <ForceGraph2D<GNode, GLink>
        ref={ref}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={180}
        d3VelocityDecay={0.28}
        onEngineStop={() => ref.current?.zoomToFit(600, 60)}
        linkColor={(l) => {
          const on = focus && (idOf(l.source) === focus || idOf(l.target) === focus);
          if (on) return 'rgba(255,110,100,0.95)';
          return l.kind === 'tangent' ? 'rgba(180,140,255,0.35)' : 'rgba(200,190,255,0.14)';
        }}
        linkWidth={(l) => (focus && (idOf(l.source) === focus || idOf(l.target) === focus) ? 2 : 0.8)}
        linkLineDash={(l) => (l.kind === 'tangent' ? [4, 3] : null)}
        nodeCanvasObject={(node, ctx, scale) => {
          const r = node.type === 'topic' ? 11 : 3.2 + Math.sqrt(node.deg) * 1.9;
          const on = lit(String(node.id));
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          if (on && focus) {
            ctx.beginPath();
            ctx.arc(x, y, r + 5, 0, Math.PI * 2);
            ctx.fillStyle = `${node.color}33`;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = on ? node.color : `${node.color}40`;
          ctx.fill();
          if (node.id === selected) {
            ctx.lineWidth = 2 / scale;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
          }
          // Few labels at a time: the focus, case files, and the cast. Evidence names only up close or on hover.
          const cast = node.type === 'entity' || node.type === 'tangent';
          const showLabel = node.type === 'topic' || node.id === focus || node.id === hover || (cast && on && scale > 0.8) || scale > 2.6;
          if (showLabel) {
            const size = node.type === 'topic' ? 14 / Math.sqrt(scale) + 2 : 11 / scale;
            ctx.font = `${node.type === 'topic' ? 600 : 400} ${size}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = on ? 'rgba(240,235,255,0.92)' : 'rgba(240,235,255,0.25)';
            const max = node.id === focus || node.id === hover ? 60 : 28;
            const label = node.title.length > max ? `${node.title.slice(0, max - 1)}…` : node.title;
            ctx.fillText(label, x, y + r + 2);
          }
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x ?? 0, node.y ?? 0, 10, 0, Math.PI * 2);
          ctx.fill();
        }}
        onNodeHover={(n) => setHover(n ? String(n.id) : null)}
        onNodeClick={(n) => {
          const id = String(n.id);
          const now = Date.now();
          // A click opens the card on the board, zoomed in.
          useUi.getState().focusNodes([id]);
          lastClick.current = { id, at: now };
        }}
        onBackgroundClick={() => useUi.getState().select()}
      />
      <div className="pointer-events-none absolute left-5 top-5 rounded-lg bg-black/40 px-3 py-2.5 text-[11.5px] text-white/75 backdrop-blur">
        <div className="mb-1.5 label-caps text-white/45">the web</div>
        {(['person', 'place', 'event', 'org', 'concept', 'work'] as const).map((t) => (
          <div key={t} className="flex items-center gap-2 leading-5">
            <span className="size-2.5 rounded-full" style={{ background: ENTITY_COLORS[t] }} />
            {ENTITY_LABEL[t]}
          </div>
        ))}
        <div className="mt-1.5 text-white/40">click a dot to see that card on the board</div>
      </div>
      {!board.nodes.length && <div className="absolute inset-0 grid place-items-center font-hand text-[26px] text-white/50">Nothing connected yet. Start a dig.</div>}
    </div>
  );
}
