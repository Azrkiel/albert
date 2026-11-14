import { nanoid } from "nanoid";
import { PAGE, type Point, type Stroke } from "../contracts";

type Affine = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;
type PointerSample = Pick<PointerEvent, "clientX" | "clientY" | "pressure" | "pointerType">;

/** Pure conversion; the DOM adapter supplies the inverse matrix and monotonic clock. */
export function toLogicalPoint(sample: PointerSample, inverse: Affine | null, now: number, sessionStart: number): Point | null {
  if (!inverse || ![...Object.values(inverse), sample.clientX, sample.clientY, now, sessionStart].every(Number.isFinite)) return null;
  const { a, b, c, d, e, f } = inverse;
  if (a * d - b * c === 0) return null;
  const x = a * sample.clientX + c * sample.clientY + e;
  const y = b * sample.clientX + d * sample.clientY + f;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const p = sample.pointerType === "mouse" || !Number.isFinite(sample.pressure) || sample.pressure <= 0
    ? 0.5 : Math.min(1, sample.pressure);
  return { x, y, t: Math.max(0, now - sessionStart), p };
}

type CaptureOptions = {
  problemId: string;
  sessionStart: number;
  now?: () => number;
  onPreview: (points: readonly Point[]) => void;
  onStroke: (stroke: Stroke) => void;
};

/** One session-scoped adapter. Cleanup discards a draft; termination commits it once. */
export function attachCapture(surface: SVGSVGElement, options: CaptureOptions): () => void {
  const now = options.now ?? (() => performance.now());
  let penSeen = false;
  let disposed = false;
  let active: { pointerId: number; pointerType: Stroke["pointerType"]; points: Point[] } | null = null;

  function convert(event: PointerSample): Point | null {
    try {
      const matrix = surface.getScreenCTM()?.inverse();
      // DOMMatrix coefficients are prototype accessors, so copy them explicitly.
      const inverse = matrix ? { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f } : null;
      return toLogicalPoint(event, inverse, now(), options.sessionStart);
    } catch {
      return null;
    }
  }

  function release(pointerId: number) {
    try {
      if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
    } catch { /* The browser may already have released or removed this pointer. */ }
  }

  function down(event: PointerEvent) {
    if (event.pointerType === "pen") penSeen = true;
    if (active || (event.pointerType === "touch" && penSeen)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen" && event.pointerType !== "touch") return;
    const point = convert(event);
    if (!point || point.x >= PAGE.albertCol.x) return;
    try { surface.setPointerCapture(event.pointerId); } catch { return; }
    active = { pointerId: event.pointerId, pointerType: event.pointerType, points: [point] };
    event.preventDefault();
    options.onPreview(active.points);
  }

  function append(event: PointerEvent) {
    if (!active) return;
    const point = convert(event);
    if (point) active.points.push(point);
  }

  function move(event: PointerEvent) {
    if (event.pointerType === "pen") penSeen = true;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event]) append(sample);
    options.onPreview(active.points);
  }

  function finish(event: PointerEvent) {
    if (!active || event.pointerId !== active.pointerId) return;
    if (event.type === "pointerup") append(event);
    const draft = active;
    active = null; // release can synchronously dispatch lostpointercapture.
    release(draft.pointerId);
    options.onPreview([]);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const point of draft.points) {
      left = Math.min(left, point.x); top = Math.min(top, point.y);
      right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
    }
    options.onStroke({
      id: `st_${nanoid()}`, problemId: options.problemId, rowId: null,
      pointerType: draft.pointerType, tool: "pen", points: draft.points,
      t0: draft.points[0]!.t, t1: draft.points[draft.points.length - 1]!.t,
      bbox: { x: left, y: top, w: right - left, h: bottom - top },
    });
  }

  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", finish);
  surface.addEventListener("pointercancel", finish);
  surface.addEventListener("lostpointercapture", finish);
  return () => {
    if (disposed) return;
    disposed = true;
    surface.removeEventListener("pointerdown", down);
    surface.removeEventListener("pointermove", move);
    surface.removeEventListener("pointerup", finish);
    surface.removeEventListener("pointercancel", finish);
    surface.removeEventListener("lostpointercapture", finish);
    const draft = active;
    active = null;
    if (draft) release(draft.pointerId);
    options.onPreview([]);
  };
}
