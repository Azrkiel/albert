import { PAGE, type SessionEvent, type Stroke } from "../contracts";
import type { SessionState } from "./store";

type XY = Readonly<{ x: number; y: number }>;
type Segment = readonly [XY, XY];
const ERASER_RADIUS = 10; // Logical pixels, independent of CSS scaling.

function distance2(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

function intersects([a, b]: Segment, [c, d]: Segment): boolean {
  const cross = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return Math.min(distance2(a, c, d), distance2(b, c, d), distance2(c, a, b), distance2(d, a, b)) <= ERASER_RADIUS ** 2;
}

/** Clip both paths to visible student ink, including segments whose endpoints lie outside. */
function segments(points: readonly XY[], fullPage = false): Segment[] {
  const result: Segment[] = [];
  const left = fullPage ? 0 : PAGE.studentCol.x;
  const right = fullPage ? PAGE.width : PAGE.studentCol.x + PAGE.studentCol.w;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[Math.min(i + 1, points.length - 1)]!;
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    const dx = b.x - a.x;
    let lo = 0, hi = 1;
    if (dx === 0) { if (a.x < left || a.x > right) continue; }
    else {
      const ends = [(left - a.x) / dx, (right - a.x) / dx];
      lo = Math.max(0, Math.min(...ends)); hi = Math.min(1, Math.max(...ends));
      if (lo > hi) continue;
    }
    const at = (t: number): XY => ({ x: a.x + t * dx, y: a.y + t * (b.y - a.y) });
    result.push([at(lo), at(hi)]);
  }
  return result;
}

function live(stroke: Stroke): boolean { return stroke.tool === "pen" && stroke.erasedAt === undefined; }

/** One completed eraser gesture, grouped by row. No DOM, clock, mutation, or history deletion. */
export function eraseGesture(state: SessionState, problemId: string, points: readonly XY[], at: number, page?: number): SessionEvent[] {
  if (state.surface === "pdf" && page === undefined) return [];
  const path = segments(points, state.surface === "pdf");
  const rows = new Map<string, string[]>();
  for (const stroke of state.strokes) {
    if (!live(stroke) || (state.surface === "pdf" ? stroke.page !== page : stroke.problemId !== problemId) || !stroke.rowId) continue;
    if (!segments(stroke.points, state.surface === "pdf").some((ink) => path.some((eraser) => intersects(ink, eraser)))) continue;
    const ids = rows.get(stroke.rowId) ?? [];
    ids.push(stroke.id); rows.set(stroke.rowId, ids);
  }
  return [...rows].map(([rowId, strokeIds]) => ({ type: "erase", at, strokeIds, rowId }));
}

export function clearRow(state: SessionState, rowId: string, at: number): SessionEvent | null {
  const strokeIds = state.strokes.filter((stroke) => stroke.rowId === rowId && live(stroke)).map(({ id }) => id);
  return strokeIds.length ? { type: "erase", at, strokeIds, rowId } : null;
}

export function historyEvent(state: SessionState, direction: "undo" | "redo", at: number, page?: number): SessionEvent | null {
  if (state.surface === "pdf" && page === undefined) return null;
  const stack = direction === "undo" ? state.undoStack : state.redoStack;
  const edit = state.surface === "pdf" ? stack.findLast(edit => state.rows.find(r => r.id === edit.rowId)?.page === page) : stack.at(-1);
  return edit ? { type: "undo", at, strokeIds: [...edit.strokeIds], rowId: edit.rowId,
    ...(direction === "redo" ? { redo: true as const } : {}) } : null;
}
