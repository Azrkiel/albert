import { targetBox } from "./geometry";
import type { BBox, Cluster, Row } from "../contracts";

export type PenPosition = { x: number; y: number };
export type MarkStep = "pointer" | "mark";
export const POINTER_MS = 300;
/** Resolve only current ink in the same problem/page. Erased/stale target ids never fall back to a row rectangle. */
export function liveMarkTarget(rows: readonly Row[], clusters: readonly Cluster[], problemId: string, sourceRowId: string, rowId: string, ids: readonly string[]): { row: Row; box: BBox } | null {
  const source = rows.find(r => r.id === sourceRowId), row = rows.find(r => r.id === rowId);
  if (!source || !row || source.problemId !== problemId || row.problemId !== problemId || row.page !== source.page) return null;
  const local = clusters.filter(c => c.rowId === rowId), wanted = new Set(ids);
  if (!local.length || local.filter(c => wanted.has(c.id)).length !== wanted.size) return null;
  const box = targetBox([...ids], local, row);
  return box ? { row, box } : null;
}
export function placePenTip(node: SVGGElement, position: PenPosition) {
  node.setAttribute("transform", `translate(${position.x} ${position.y})`);
  node.setAttribute("data-pointer-x", String(position.x)); node.setAttribute("data-pointer-y", String(position.y));
}
export const targetCentre = (box: BBox): PenPosition => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

/** Explicit conductor order; reduced motion and later marks skip the pointer step. */
export function pointerSteps(first: boolean, reducedMotion: boolean): MarkStep[] {
  return first && !reducedMotion ? ["pointer", "mark"] : ["mark"];
}
export async function runMarkSteps(steps: readonly MarkStep[], handlers: Record<MarkStep, () => void | Promise<void>>): Promise<void> {
  for (const step of steps) await handlers[step]();
}
/** Pure motion geometry: clock and DOM belong to the adapter below. */
export function pointerAt(from: PenPosition, to: PenPosition, elapsed: number, duration = POINTER_MS): PenPosition {
  const t = duration <= 0 ? 1 : Math.max(0, Math.min(1, elapsed / duration));
  const ease = t * t * (3 - 2 * t);
  return { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
}

/** Keep one painted frame at the target before the mark step is allowed to create its group. */
export function movePenTip(node: SVGGElement, from: PenPosition, to: PenPosition, options: {
  cancelled: () => boolean; target?: () => PenPosition | null; skip: () => boolean; onPosition: (position: PenPosition) => void;
}): Promise<void> {
  const place = (position: PenPosition) => {
    placePenTip(node, position);
    options.onPosition(position);
  };
  place(from);
  return new Promise(resolve => {
    const start = performance.now();
    const frame = (now: number) => {
      if (options.cancelled()) { resolve(); return; }
      const target = options.target ? options.target() : to;
      if (!target) { resolve(); return; }
      const elapsed = options.skip() ? POINTER_MS : now - start;
      place(pointerAt(from, target, elapsed));
      if (elapsed < POINTER_MS) { requestAnimationFrame(frame); return; }
      node.setAttribute("data-pointer-arrived", "true");
      requestAnimationFrame(() => resolve());
    };
    requestAnimationFrame(frame);
  });
}
