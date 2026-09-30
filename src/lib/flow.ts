import type { ReactFlowInstance } from '@xyflow/react';
import type { ClueNode, StringEdge } from '../types';
import type { Point } from './factory';

// The live React Flow instance, so code outside components (digs, search pins)
// can find the viewport center or fly the camera.
let instance: ReactFlowInstance<ClueNode, StringEdge> | null = null;
let element: HTMLElement | null = null;

export function registerFlow(rf: ReactFlowInstance<ClueNode, StringEdge> | null, el: HTMLElement | null) {
  instance = rf;
  element = el;
}

export const flow = () => instance;

export function viewportCenter(): Point {
  if (!instance || !element) return { x: 0, y: 0 };
  const r = element.getBoundingClientRect();
  return instance.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

export function screenToFlow(x: number, y: number): Point {
  return instance ? instance.screenToFlowPosition({ x, y }) : { x, y };
}
