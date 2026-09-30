import clsx from 'clsx';
import { useRef, useState } from 'react';

interface Props {
  /** Which edge of the panel the handle sits on. */
  edge: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  initial: number;
  onResize: (w: number) => void;
  onCollapse: () => void;
}

/** Drag to resize a side panel; drag past the minimum to collapse it; double-click to reset. */
export function ResizeHandle({ edge, width, min, max, initial, onResize, onCollapse }: Props) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const frame = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setDragging(true);
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = e.clientX - start.current.x;
        const next = start.current.w + (edge === 'right' ? delta : -delta);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => onResize(Math.max(min, Math.min(max, next))));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const delta = e.clientX - start.current.x;
        const next = start.current.w + (edge === 'right' ? delta : -delta);
        start.current = null;
        setDragging(false);
        document.body.style.cursor = '';
        if (next < min - 80) onCollapse();
      }}
      onDoubleClick={() => onResize(initial)}
      className={clsx(
        'group absolute top-0 bottom-0 z-30 w-2.5 cursor-col-resize touch-none',
        edge === 'right' ? '-right-1.5' : '-left-1.5',
      )}
    >
      <div
        className={clsx(
          'absolute top-0 bottom-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition',
          dragging ? 'bg-[#c8322f]' : 'bg-transparent group-hover:bg-[#c8322f]/60',
        )}
      />
    </div>
  );
}
