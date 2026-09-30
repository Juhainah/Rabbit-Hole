import {
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import type { SourceItem } from '../../../shared/types';
import { addClue, pinItem, pinUrl } from '../../lib/dig';
import { registerFlow, screenToFlow } from '../../lib/flow';
import { play } from '../../lib/sound';
import { tie } from '../../lib/tie';
import { nodeColor } from '../../lib/utils';
import { RAISED_Z, STRING_Z } from '../../lib/factory';
import { useBoards, useCurrentBoard } from '../../store/boards';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import type { ClueNode, StringEdge } from '../../types';
import { ActivityTicker } from './ActivityTicker';
import { ContextMenu } from './ContextMenu';
import { EmptyState } from './EmptyState';
import { nodeTypes } from './nodes';
import { edgeTypes, StringConnectionLine } from './StringEdge';
import { TiePicker } from './TiePicker';
import { Toolbar } from './Toolbar';

/**
 * Moves the cork texture with the camera so the board feels physical, and sets
 * the level of detail: far out, cards drop their small print and show big titles.
 */
function ViewportSync({ target }: { target: RefObject<HTMLDivElement | null> }) {
  const { x, y, zoom } = useViewport();
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    el.style.setProperty('--bx', `${x}px`);
    el.style.setProperty('--by', `${y}px`);
    el.style.setProperty('--z', String(zoom));
    const lod = zoom < 0.34 ? 'far' : zoom < 0.6 ? 'mid' : 'near';
    if (el.dataset.lod !== lod) el.dataset.lod = lod;
  }, [x, y, zoom, target]);
  return null;
}

// Constant props and handlers that need nothing from the component, defined once.
const EDGE_DEFAULTS = { type: 'string', zIndex: STRING_Z } as const;
const FIT_OPTIONS = { padding: 0.2, maxZoom: 0.9 };
const DELETE_KEYS = ['Delete', 'Backspace'];
const PRO_OPTIONS = { hideAttribution: false };
const MINIMAP_STYLE = { width: 170, height: 118, marginRight: 12, marginBottom: 12 };
const MINIMAP_FRAMED = { ...MINIMAP_STYLE, marginRight: 30, marginBottom: 30 };
const CONTROLS_STYLE = { marginLeft: 12, marginBottom: 12 };
const CONTROLS_FRAMED = { marginLeft: 30, marginBottom: 30 };
const onNodeClick: NodeMouseHandler<ClueNode> = (e, n) => {
  const prev = useUi.getState().selectedNodeId;
  if (e.shiftKey && prev && prev !== n.id) tie(prev, n.id);
  useUi.getState().select(n.id);
};
const onNodeContext: NodeMouseHandler<ClueNode> = (e, n) => {
  e.preventDefault();
  useUi.getState().select(n.id);
  useUi.getState().set({ menu: { x: e.clientX, y: e.clientY, nodeId: n.id } });
};
const onEdgeClick: EdgeMouseHandler<StringEdge> = (_, edge) => useUi.getState().select(undefined, edge.id);
const onEdgeContext: EdgeMouseHandler<StringEdge> = (e, edge) => {
  e.preventDefault();
  useUi.getState().set({ menu: { x: e.clientX, y: e.clientY, edgeId: edge.id }, selectedEdgeId: edge.id });
};
const onPaneClick = () => useUi.getState().set({ selectedNodeId: undefined, selectedEdgeId: undefined, menu: undefined });
const onNodeDragStop = () => play('pin');

/** Trackpads send small or fractional wheel deltas (and sideways ones); mouse wheels send big notches. */
const looksLikeTrackpad = (e: WheelEvent) => e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40);

function Board() {
  const board = useCurrentBoard();
  const onNodesChange = useBoards((s) => s.onNodesChange);
  const onEdgesChange = useBoards((s) => s.onEdgesChange);
  const onConnect = useBoards((s) => s.onConnect);
  const theme = useSettings((s) => s.theme);
  const font = useSettings((s) => s.font);
  const minimap = useSettings((s) => s.minimap);
  const frame = useSettings((s) => s.frame);
  const focusRequest = useUi((s) => s.focusRequest);
  const arranging = useUi((s) => s.arranging);
  const spotlight = useUi((s) => s.spotlight);
  const selectedNodeId = useUi((s) => s.selectedNodeId);
  // Only a string you click rises above the cards. React Flow's own option also lifts every
  // string on a selected card, which buried the case file under its own strings.
  const selectedEdgeId = useUi((s) => s.selectedEdgeId);
  const edges = useMemo(
    () => (selectedEdgeId ? board.edges.map((e) => (e.id === selectedEdgeId ? { ...e, zIndex: RAISED_Z } : e)) : board.edges),
    [board.edges, selectedEdgeId],
  );
  const scrollPref = useSettings((s) => s.scroll);
  const [detected, setDetected] = useState<'pan' | 'zoom' | null>(null);
  const scrollMode = scrollPref === 'auto' ? (detected ?? 'zoom') : scrollPref;
  const rf = useReactFlow<ClueNode, StringEdge>();
  const wrap = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    registerFlow(rf, wrap.current);
    return () => registerFlow(null, null);
  }, [rf]);

  // Fly the camera to whatever a dig or the sidebar asked to see.
  useEffect(() => {
    if (!focusRequest?.ids.length) return;
    const t = setTimeout(() => {
      // A soft focus (the spotlight) leaves the camera alone when everything is already in view.
      if (focusRequest.soft && wrap.current) {
        const b = rf.getNodesBounds(focusRequest.ids);
        const r = wrap.current.getBoundingClientRect();
        const tl = rf.screenToFlowPosition({ x: r.left, y: r.top });
        const br = rf.screenToFlowPosition({ x: r.right, y: r.bottom });
        if (b.x >= tl.x && b.y >= tl.y && b.x + b.width <= br.x && b.y + b.height <= br.y) return;
      }
      void rf.fitView({ nodes: focusRequest.ids.map((id) => ({ id })), duration: 520, padding: 0.18, maxZoom: 0.95 });
    }, 40);
    return () => clearTimeout(t);
  }, [focusRequest, rf]);

  // A different board: frame whatever is on it instead of keeping the old camera.
  const currentId = useBoards((s) => s.currentId);
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.15, duration: 500, maxZoom: 0.9 }), 120);
    return () => clearTimeout(t);
  }, [currentId, rf]);
  // A spotlight belongs to the board it was set on.
  useEffect(() => useUi.getState().set({ spotlight: [] }), [currentId]);

  // Keep React Flow's selection in sync with ours (inspector, graph, map clicks).
  useEffect(() => {
    if (!selectedNodeId) return;
    const n = board.nodes.find((x) => x.id === selectedNodeId);
    if (n && !n.selected) onNodesChange(board.nodes.map((x) => ({ id: x.id, type: 'select' as const, selected: x.id === selectedNodeId })));
  }, [selectedNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every handler React Flow gets must keep its identity between renders: a fresh function
  // makes it redraw every card and string on each frame of a drag.
  const onNodeDoubleClick = useCallback<NodeMouseHandler<ClueNode>>(
    (e, n) => {
      // Notes and labels use double-click to start typing, so leave the camera alone.
      if (n.type === 'note' || n.type === 'label' || (e.target as HTMLElement).closest('textarea, input')) return;
      useUi.getState().select(n.id);
      useUi.getState().openTab('inspect');
      void rf.fitView({ nodes: [{ id: n.id }], duration: 600, padding: 0.4, maxZoom: 1.15 });
    },
    [rf],
  );
  const onMoveStart = useCallback(() => {
    clearTimeout(settle.current);
    wrap.current?.classList.add('moving');
  }, []);
  // Wheel zoom fires a start/end pair per notch; flipping the mode each time restyled every card.
  const onMoveEnd = useCallback(() => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => wrap.current?.classList.remove('moving'), 200);
  }, []);
  const onConnectString = useCallback<OnConnect>(
    (c) => {
      onConnect(c);
      play('string');
    },
    [onConnect],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const at = screenToFlow(e.clientX, e.clientY);
    const item = e.dataTransfer.getData('application/x-rabbithole');
    if (item) {
      pinItem(JSON.parse(item) as SourceItem, { at });
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//.test(url.trim())) pinUrl(url.trim().split('\n')[0], { at });
    else if (url.trim()) addClue('note', { text: url.trim(), title: url.trim().slice(0, 60) }, { at });
  };

  return (
    <div
      ref={wrap}
      className={clsx('board', `theme-${theme}`, `bfont-${font}`, arranging && 'arranging', spotlight.length > 0 && 'spotlighting', selectedNodeId && 'has-selection')}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
      onWheelCapture={(e) => {
        if (scrollPref !== 'auto' || detected || e.ctrlKey) return;
        if (looksLikeTrackpad(e.nativeEvent)) setDetected('pan');
        else if (Math.abs(e.deltaY) >= 100) setDetected('zoom');
      }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
        addClue('note', {}, { at: screenToFlow(e.clientX, e.clientY) });
      }}
    >
      {spotlight.length > 0 && (
        // Lights the picked card types without touching the cards themselves.
        <style>{`${spotlight.filter((t) => /^[a-z]+$/.test(t)).map((t) => `.board.spotlighting .react-flow__node-${t}`).join(',')}{opacity:1}`}</style>
      )}
      <ReactFlow<ClueNode, StringEdge>
        nodes={board.nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectString}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={StringConnectionLine}
        defaultEdgeOptions={EDGE_DEFAULTS}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContext}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContext}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        zoomOnDoubleClick={false}
        panOnScroll={scrollMode === 'pan'}
        zoomOnScroll={scrollMode === 'zoom'}
        zoomOnPinch
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        minZoom={0.04}
        maxZoom={2.5}
        fitView
        fitViewOptions={FIT_OPTIONS}
        deleteKeyCode={DELETE_KEYS}
        elevateNodesOnSelect
        proOptions={PRO_OPTIONS}
      >
        <ViewportSync target={wrap} />
        {minimap && (
          <MiniMap<ClueNode>
            pannable
            zoomable
            nodeColor={nodeColor}
            nodeBorderRadius={2}
            maskColor="rgba(43,34,28,0.12)"
            position="bottom-right"
            style={frame ? MINIMAP_FRAMED : MINIMAP_STYLE}
          />
        )}
        <Controls showInteractive={false} position="bottom-left" style={frame ? CONTROLS_FRAMED : CONTROLS_STYLE} />
      </ReactFlow>
      {frame && <div className="board-frame" />}
      {board.nodes.length === 0 && <EmptyState />}
      <Toolbar />
      <ActivityTicker />
      <ContextMenu />
      <TiePicker />
    </div>
  );
}

export function BoardView() {
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  );
}
