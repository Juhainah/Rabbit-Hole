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
  type OnConnectEnd,
  type OnNodeDrag,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react';
import type { SourceItem } from '../../../shared/types';
import { addClue, pinItem, pinUrl } from '../../lib/dig';
import { addFiles, addPasted, shrink } from '../../lib/evidence';
import { registerFlow, screenToFlow } from '../../lib/flow';
import { play } from '../../lib/sound';
import { tie } from '../../lib/tie';
import { nodeColor } from '../../lib/utils';
import { RAISED_Z, sizeOf, STRING_Z, type Point } from '../../lib/factory';
import { currentBoard, useBoards, useCurrentBoard } from '../../store/boards';
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
export function ViewportSync({ target }: { target: RefObject<HTMLDivElement | null> }) {
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
// A theory frame carries the cards inside it when you move it.
let carrying: { id: string; from: Point; cards: Map<string, Point> } | null = null;
const inside = (n: ClueNode, f: ClueNode) => {
  const s = sizeOf(n);
  const fs = sizeOf(f);
  const cx = n.position.x + s.w / 2;
  const cy = n.position.y + s.h / 2;
  return cx > f.position.x && cx < f.position.x + fs.w && cy > f.position.y && cy < f.position.y + fs.h;
};
const onNodeDragStart: OnNodeDrag<ClueNode> = (_, node) => {
  if (node.type !== 'frame') return;
  const cards = currentBoard().nodes.filter((n) => n.id !== node.id && n.type !== 'frame' && !n.selected && inside(n, node));
  carrying = { id: node.id, from: { ...node.position }, cards: new Map(cards.map((n) => [n.id, { ...n.position }])) };
};
const onNodeDrag: OnNodeDrag<ClueNode> = (_, node) => {
  const c = carrying;
  if (!c || c.id !== node.id || !c.cards.size) return;
  const dx = node.position.x - c.from.x;
  const dy = node.position.y - c.from.y;
  useBoards.getState().updateNodes((n) => {
    const p = c.cards.get(n.id);
    return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
  });
};
const onNodeDragStop = () => {
  carrying = null;
  play('pin');
};
const SNAP_GRID: [number, number] = [20, 20];
const PAN_MOUSE: number[] = [1, 2];

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
  const snap = useSettings((s) => s.snap);
  const selecting = useUi((s) => s.selecting);
  const building = useUi((s) => s.building);
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

  // The board never scrolls: it pans. But when a box on a card takes focus, the browser may scroll the
  // board's frame to show it, shoving the toolbar and everything else sideways off the screen. Undo that.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reset = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t !== el && !t.classList?.contains('react-flow') && !t.classList?.contains('react-flow__renderer') && !t.classList?.contains('react-flow__pane')) return;
      if (t.scrollLeft || t.scrollTop) {
        t.scrollLeft = 0;
        t.scrollTop = 0;
      }
    };
    el.addEventListener('scroll', reset, true);
    return () => el.removeEventListener('scroll', reset, true);
  }, []);

  useEffect(() => {
    registerFlow(rf, wrap.current);
    return () => registerFlow(null, null);
  }, [rf]);

  // Fly the camera to whatever a dig or the sidebar asked to see.
  useEffect(() => {
    if (!focusRequest?.ids.length) return;
    // Coming from another view the board has just mounted: wait until the cards are measured.
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const ready = () => focusRequest.ids.every((id) => rf.getInternalNode(id)?.measured?.width);
    const go = () => {
      if (!ready() && tries++ < 20) {
        t = setTimeout(go, 60);
        return;
      }
      fly();
    };
    const fly = () => {
      // A soft focus (the spotlight) leaves the camera alone when everything is already in view.
      if (focusRequest.soft && wrap.current) {
        const b = rf.getNodesBounds(focusRequest.ids);
        const r = wrap.current.getBoundingClientRect();
        const tl = rf.screenToFlowPosition({ x: r.left, y: r.top });
        const br = rf.screenToFlowPosition({ x: r.right, y: r.bottom });
        if (b.x >= tl.x && b.y >= tl.y && b.x + b.width <= br.x && b.y + b.height <= br.y) return;
      }
      void rf.fitView({ nodes: focusRequest.ids.map((id) => ({ id })), duration: 520, padding: 0.18, maxZoom: 0.95 });
      if (focusRequest.ids.length === 1 && !focusRequest.soft) useUi.getState().select(focusRequest.ids[0]);
    };
    t = setTimeout(go, 40);
    return () => clearTimeout(t);
  }, [focusRequest, rf]);

  // A different board: frame whatever is on it instead of keeping the old camera.
  const currentId = useBoards((s) => s.currentId);
  useEffect(() => {
    // Arriving here to look at one card (from the Web, Timeline or Map view): that card wins.
    const asked = useUi.getState().focusRequest;
    if (asked && Date.now() - asked.at < 1500) return;
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
    (raw) => {
      // Strings always hang from the pins, whichever grip they were drawn from.
      const c = { ...raw, sourceHandle: !raw.sourceHandle || raw.sourceHandle === 'tie' ? 'pin' : raw.sourceHandle, targetHandle: !raw.targetHandle || raw.targetHandle === 'tie' ? 'pin' : raw.targetHandle };
      if (c.source === c.target) return;
      const before = new Set(useBoards.getState().boards[useBoards.getState().currentId]?.edges.map((e) => e.id));
      onConnect(c);
      play('string');
      // The string you just drew asks for its label ("romantic partner", "paid by"…); Enter skips it.
      const made = currentBoard().edges.find((e) => !before.has(e.id));
      if (made) useUi.getState().set({ labelEdit: made.id, selectedEdgeId: made.id });
    },
    [onConnect],
  );
  // A thread let go anywhere on another card (not just on its pin) ties to that card.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || !state.fromNode) return;
      const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
      if (!pt) return;
      const under = document
        .elementsFromPoint(pt.clientX, pt.clientY)
        .map((el) => el.closest('.react-flow__node'))
        .find((el): el is HTMLElement => !!el && el.getAttribute('data-id') !== state.fromNode!.id && !el.classList.contains('react-flow__node-frame'));
      const target = under?.getAttribute('data-id');
      if (target) onConnectString({ source: state.fromNode.id, sourceHandle: 'pin', target, targetHandle: 'pin' });
    },
    [onConnectString],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const at = screenToFlow(e.clientX, e.clientY);
    const item = e.dataTransfer.getData('application/x-rabbithole');
    if (item) {
      pinItem(JSON.parse(item) as SourceItem, { at });
      return;
    }
    // Photos, PDFs and text files from your computer.
    const files = [...e.dataTransfer.files];
    const onCard = (e.target as Element).closest?.('.react-flow__node')?.getAttribute('data-id');
    const picture = files.length === 1 && files[0].type.startsWith('image/') ? files[0] : undefined;
    const card = onCard ? currentBoard().nodes.find((n) => n.id === onCard) : undefined;
    if (picture && card && card.type !== 'frame' && card.type !== 'gallery' && card.type !== 'map') {
      void shrink(picture).then((image) => {
        useBoards.getState().snapshot(`Photo on “${card.data.title}”`);
        useBoards.getState().updateNode(card.id, { image });
      });
      return;
    }
    if (files.length) {
      void addFiles(files, { at });
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//.test(url.trim())) pinUrl(url.trim().split('\n')[0], { at });
    else if (url.trim()) addClue('note', { text: url.trim(), title: url.trim().slice(0, 60) }, { at });
  };

  // Paste anywhere on the board (not into a text box): pictures, links or text become cards.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target instanceof Element ? e.target : document.activeElement;
      if (!e.clipboardData || t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!wrap.current?.isConnected || useUi.getState().view !== 'board') return;
      const near = useUi.getState().selectedNodeId;
      e.preventDefault();
      void addPasted(e.clipboardData, near ? { near } : {});
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div
      ref={wrap}
      className={clsx('board', `theme-${theme}`, `bfont-${font}`, arranging && 'arranging', spotlight.length > 0 && 'spotlighting', selectedNodeId && 'has-selection', selecting && 'selecting')}
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
        onConnectEnd={onConnectEnd}
        connectionRadius={36}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={StringConnectionLine}
        defaultEdgeOptions={EDGE_DEFAULTS}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContext}
        onEdgeClick={onEdgeClick}
        onEdgeContextMenu={onEdgeContext}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        snapToGrid={snap}
        snapGrid={SNAP_GRID}
        // "Select many": dragging on the empty board draws a selection box; the board pans with the middle or right button.
        selectionOnDrag={!!selecting}
        panOnDrag={selecting ? PAN_MOUSE : true}
        selectionMode={SelectionMode.Partial}
        // Very big boards only draw what is on screen. (Cards drawn again as they scroll in blink, so not before then.)
        onlyRenderVisibleElements={board.nodes.length > 160}
        zoomOnDoubleClick={false}
        panOnScroll={scrollMode === 'pan'}
        zoomOnScroll={scrollMode === 'zoom'}
        zoomOnPinch
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        minZoom={0.04}
        maxZoom={2.5}
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
      {/* An empty board shows the start card; once you start building, the board and its tools. */}
      {board.nodes.length === 0 && building !== board.id ? (
        <EmptyState />
      ) : (
        <>
          {board.nodes.length === 0 && (
            <div className="blank-hint">
              <b>Your blank board</b>
              Press the red <span>+</span> below to pin a person, place, photo, PDF or note. Drag cards to arrange them; drag from one pin to another to tie a string.
            </div>
          )}
          <Toolbar />
        </>
      )}
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
