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
function segments(points: readonly XY[]): Segment[] {
  const result: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[Math.min(i + 1, points.length - 1)]!;
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    const dx = b.x - a.x;
    let lo = 0, hi = 1;
    if (dx === 0) { if (a.x < PAGE.studentCol.x || a.x > PAGE.studentCol.x + PAGE.studentCol.w) continue; }
    else {
      const ends = [(PAGE.studentCol.x - a.x) / dx, (PAGE.studentCol.x + PAGE.studentCol.w - a.x) / dx];
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
export function eraseGesture(state: SessionState, problemId: string, points: readonly XY[], at: number): SessionEvent[] {
  const path = segments(points);
  const rows = new Map<string, string[]>();
  for (const stroke of state.strokes) {
    if (!live(stroke) || stroke.problemId !== problemId || !stroke.rowId) continue;
    if (!segments(stroke.points).some((ink) => path.some((eraser) => intersects(ink, eraser)))) continue;
    const ids = rows.get(stroke.rowId) ?? [];
    ids.push(stroke.id); rows.set(stroke.rowId, ids);
  }
  return [...rows].map(([rowId, strokeIds]) => ({ type: "erase", at, strokeIds, rowId }));
}

export function clearRow(state: SessionState, rowId: string, at: number): SessionEvent | null {
  const strokeIds = state.strokes.filter((stroke) => stroke.rowId === rowId && live(stroke)).map(({ id }) => id);
  return strokeIds.length ? { type: "erase", at, strokeIds, rowId } : null;
}

export function historyEvent(state: SessionState, direction: "undo" | "redo", at: number): SessionEvent | null {
  const edit = (direction === "undo" ? state.undoStack : state.redoStack).at(-1);
  return edit ? { type: "undo", at, strokeIds: [...edit.strokeIds], rowId: edit.rowId,
    ...(direction === "redo" ? { redo: true as const } : {}) } : null;
}
