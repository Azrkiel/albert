import { describe, expect, it, vi } from "vitest";
import { PAGE, StrokeSchema, type Point, type Stroke } from "../../src/lib/contracts";
import { attachCapture, toLogicalPoint } from "../../src/lib/canvas/capture";
import { strokeOutline, strokePath } from "../../src/lib/canvas/path";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const sample = { clientX: 110, clientY: 70, pressure: 0.7, pointerType: "pen" };

describe("logical point conversion (P2.1-AC1)", () => {
  it("converts translated/scaled coordinates and session-relative time", () => {
    const inverse = { a: 2, b: 0, c: 0, d: 2, e: -20, f: -40 };
    expect(toLogicalPoint(sample, inverse, 125, 100)).toEqual({ x: 200, y: 100, t: 25, p: 0.7 });
    expect(toLogicalPoint(sample, inverse, 130, 100)?.t).toBe(30);
  });

  it("supports rotated/skewed transforms and clamps time before session start", () => {
    expect(toLogicalPoint(sample, { a: 0, b: 1, c: -1, d: 0.5, e: 5, f: 10 }, 99, 100))
      .toEqual({ x: -65, y: 155, t: 0, p: 0.7 });
  });

  it.each([ ["mouse", 0.9, 0.5], ["touch", 0, 0.5], ["pen", 0, 0.5], ["pen", 1, 1] ])
    ("normalizes %s pressure %s to %s", (pointerType, pressure, p) => {
      expect(toLogicalPoint({ ...sample, pointerType, pressure }, identity, 10, 0)?.p).toBe(p);
    });

  it.each([null, { ...identity, a: NaN }, { ...identity, e: Infinity }, { ...identity, d: 0 }])
    ("rejects missing, nonfinite or singular transforms: %s", (inverse) => {
      expect(toLogicalPoint(sample, inverse, 10, 0)).toBeNull();
    });

  it("rejects invalid sample coordinates and clocks", () => {
    expect(toLogicalPoint({ ...sample, clientX: Infinity }, identity, 10, 0)).toBeNull();
    expect(toLogicalPoint(sample, identity, NaN, 0)).toBeNull();
  });
});

// EventTarget exercises the real listener adapter without React, DOM, or real clocks.
class Surface extends EventTarget {
  inverse: typeof identity | null = identity;
  captured = new Set<number>();
  failCapture = false;
  failInverse = false;
  setPointerCapture(id: number) {
    if (this.failCapture) throw new Error("pointer no longer active");
    this.captured.add(id);
  }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
    this.emit("lostpointercapture", { pointerId: id });
  }
  getScreenCTM() {
    return this.inverse && { inverse: () => {
      if (this.failInverse) throw new Error("singular matrix");
      return this.inverse;
    } };
  }
  emit(type: string, fields: Partial<PointerEvent> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: "pen", clientX: 100, clientY: 60,
      pressure: 0.7, button: 0, buttons: 1, ...fields,
    });
    this.dispatchEvent(event);
    return event;
  }
}

function setup() {
  const surface = new Surface();
  const strokes: Stroke[] = [];
  let clock = 100;
  const preview = vi.fn<(points: readonly Point[]) => void>();
  const dispose = attachCapture(surface as unknown as SVGSVGElement, {
    problemId: "demo/p1", sessionStart: 100, now: () => clock++,
    onPreview: preview, onStroke: (stroke) => strokes.push(stroke),
  });
  return { surface, strokes, preview, dispose };
}

describe("capture lifecycle", () => {
  it("captures, keeps coalesced points once, falls back for empty/missing batches, and stores a contract stroke", () => {
    const { surface, strokes } = setup();
    surface.emit("pointerdown");
    expect(surface.hasPointerCapture(1)).toBe(true);
    surface.emit("pointermove", { clientX: 140, getCoalescedEvents: () => [
      { ...sample, clientX: 120 } as PointerEvent,
      { ...sample, clientX: 140 } as PointerEvent,
    ] });
    surface.emit("pointermove", { clientX: 150, getCoalescedEvents: () => [] });
    surface.emit("pointermove", { clientX: 160 });
    surface.emit("pointerup", { clientX: 170 });
    const stroke = strokes[0]!;
    expect(strokes).toHaveLength(1);
    expect(StrokeSchema.safeParse(stroke).success).toBe(true);
    expect(stroke.id).toMatch(/^st_/);
    expect(stroke).toMatchObject({ problemId: "demo/p1", rowId: null, pointerType: "pen", tool: "pen", t0: 0, t1: 5 });
    expect(stroke.points.map((point) => point.x)).toEqual([100, 120, 140, 150, 160, 170]);
    expect(stroke.points.map((point) => point.t)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stroke.bbox).toEqual({ x: 100, y: 60, w: 70, h: 10 });
    expect(surface.hasPointerCapture(1)).toBe(false);
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture"])("finishes once on %s, even with repeated termination", (termination) => {
    const { surface, strokes, preview } = setup();
    surface.emit("pointerdown");
    surface.emit("pointermove", { clientX: 200 });
    surface.emit(termination);
    surface.emit("pointerup");
    surface.emit("pointercancel");
    surface.emit("lostpointercapture");
    expect(strokes).toHaveLength(1);
    expect(preview).toHaveBeenLastCalledWith([]);
  });

  it("ignores second pointers without terminating or moving the active stroke", () => {
    const { surface, strokes } = setup();
    surface.emit("pointerdown");
    surface.emit("pointerdown", { pointerId: 2 });
    surface.emit("pointermove", { pointerId: 2, clientX: 999 });
    surface.emit("pointerup", { pointerId: 2 });
    expect(strokes).toHaveLength(0);
    surface.emit("pointerup");
    expect(strokes[0]!.points.every((point) => point.x === 100)).toBe(true);
  });

  it("allows touch until a pen is seen, then rejects palms for the rest of the session", () => {
    const { surface, strokes } = setup();
    for (const pointerType of ["touch", "pen", "touch", "mouse"]) {
      surface.emit("pointerdown", { pointerType });
      surface.emit("pointerup", { pointerType });
    }
    expect(strokes.map((stroke) => stroke.pointerType)).toEqual(["touch", "pen", "mouse"]);
  });

  it("rejects palms after observing a hovering pen, before its first stroke", () => {
    const { surface, strokes } = setup();
    surface.emit("pointermove", { pointerType: "pen", buttons: 0 });
    surface.emit("pointerdown", { pointerType: "touch" });
    surface.emit("pointerup", { pointerType: "touch" });
    expect(strokes).toHaveLength(0);
  });

  it("rejects secondary mouse buttons and starts in Albert's column", () => {
    const { surface, strokes } = setup();
    surface.emit("pointerdown", { pointerType: "mouse", button: 2 });
    surface.emit("pointerdown", { clientX: PAGE.albertCol.x });
    surface.emit("pointermove", { clientX: 100 });
    surface.emit("pointerup");
    expect(strokes).toHaveLength(0);
    expect(surface.captured.size).toBe(0);
  });

  it("retains raw samples beyond the student column for render-time clipping", () => {
    const { surface, strokes } = setup();
    surface.emit("pointerdown");
    surface.emit("pointermove", { clientX: 900 });
    surface.emit("pointerup", { clientX: 100 });
    expect(strokes[0]!.points.map((point) => point.x)).toEqual([100, 900, 100]);
  });

  it("reads fresh transforms after resizing, skipping invalid samples and safely finishing", () => {
    const { surface, strokes } = setup();
    surface.inverse = null;
    surface.emit("pointerdown");
    expect(surface.captured.size).toBe(0);
    surface.inverse = identity;
    surface.emit("pointerdown");
    surface.inverse = { ...identity, a: 2, d: 2 };
    surface.emit("pointermove", { clientX: 120 });
    surface.failInverse = true;
    surface.emit("pointermove");
    surface.emit("pointerup");
    expect(strokes[0]!.points.map((point) => point.x)).toEqual([100, 240]);
  });

  it("ignores failed capture and can start again", () => {
    const { surface, strokes } = setup();
    surface.failCapture = true;
    surface.emit("pointerdown");
    surface.emit("pointerup");
    expect(strokes).toHaveLength(0);
    surface.failCapture = false;
    surface.emit("pointerdown");
    surface.emit("pointerup");
    expect(strokes).toHaveLength(1);
  });

  it("unmount releases capture, removes listeners, and discards unfinished ink without committing", () => {
    const { surface, strokes, preview, dispose } = setup();
    surface.emit("pointerdown");
    dispose();
    const calls = preview.mock.calls.length;
    dispose();
    surface.emit("pointerup");
    surface.emit("pointerdown");
    expect(surface.captured.size).toBe(0);
    expect(strokes).toHaveLength(0);
    expect(preview).toHaveBeenCalledTimes(calls);
  });
});

describe("shared ink outlines", () => {
  const points = [{ x: 100, y: 100, t: 0, p: 0.5 }, { x: 150, y: 120, t: 5, p: 0.8 }];
  it("creates closed finite SVG ink, including a single-point dot", () => {
    expect(strokePath([])).toBe("");
    for (const input of [points, points.slice(0, 1)]) {
      expect(strokeOutline(input).length).toBeGreaterThan(2);
      expect(strokePath(input)).toMatch(/^M.*Z$/);
      expect(strokePath(input)).not.toMatch(/NaN|Infinity/);
    }
  });
  it("uses supplied pressure without mutating the timed points", () => {
    const original = structuredClone(points);
    expect(strokeOutline(points)).not.toEqual(strokeOutline(points.map((point) => ({ ...point, p: 0.1 }))));
    expect(points).toEqual(original);
  });
});
