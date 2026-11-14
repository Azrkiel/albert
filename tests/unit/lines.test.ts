import { describe, expect, it } from "vitest";
import { LINE, PAGE, type BBox, type Stroke } from "../../src/lib/contracts";
import { assignLine, createSessionState, exportRecording, freeSurfaceHeight, lineRows, parseRecording, reduceSessionEvent, type SessionState } from "../../src/lib/canvas";

let seq = 0;
function pen(box: BBox, extra: Partial<Stroke> = {}): Stroke {
  const t0 = seq * 100;
  seq++;
  return { id: `st_${String(seq).padStart(3, "0")}`, problemId: "p1", rowId: null, tool: "pen", pointerType: "pen",
    points: [{ x: box.x, y: box.y, t: t0, p: 0.5 }, { x: box.x + box.w, y: box.y + box.h, t: t0 + 50, p: 0.5 }],
    t0, t1: t0 + 50, bbox: box, ...extra };
}

/** Writes strokes in order through the reducer in the free layout, as the page does. */
function write(strokes: Stroke[], problems = ["p1"]): SessionState {
  return strokes.reduce((state, stroke) => reduceSessionEvent(state, { type: "stroke_end", at: stroke.t1, stroke }),
    createSessionState(problems, "ws", undefined, "free"));
}
const rowOf = (state: SessionState, id: string) => state.strokes.find((s) => s.id === id)!.rowId;
const indexOf = (state: SessionState, id: string) => state.rows.find((r) => r.id === rowOf(state, id))!.index;

describe("assignLine (P2.5a-AC1)", () => {
  it("two lines of work separated by whitespace give two rows", () => {
    const a = pen({ x: 100, y: 120, w: 40, h: 30 }), b = pen({ x: 150, y: 125, w: 30, h: 25 });
    const c = pen({ x: 100, y: 200, w: 40, h: 30 });
    const state = write([a, b, c]);
    expect(state.rows.map((r) => [r.id, r.index])).toEqual([["p1/r1", 1], ["p1/r2", 2]]);
    expect([rowOf(state, a.id), rowOf(state, b.id), rowOf(state, c.id)]).toEqual(["p1/r1", "p1/r1", "p1/r2"]);
  });

  const numerator = () => pen({ x: 150, y: 100, w: 30, h: 28 });
  const bar = () => pen({ x: 120, y: 134, w: 100, h: 4 });
  const denominator = () => pen({ x: 130, y: 144, w: 80, h: 30 });
  it.each([
    ["numerator → bar → denominator", [0, 1, 2]],
    ["denominator → bar → numerator", [2, 1, 0]],
    ["bar → numerator → denominator", [1, 0, 2]],
  ])("a stacked fraction written %s is one row", (_, order) => {
    const parts = [numerator(), bar(), denominator()];
    const state = write((order as number[]).map((i) => parts[i]!));
    expect(state.rows).toHaveLength(1);
    expect(new Set(parts.map((p) => rowOf(state, p.id))).size).toBe(1);
  });

  it("big writing: a fraction whose gaps exceed LINE.GAP but stay under half a part's height is one row", () => {
    const num = pen({ x: 150, y: 100, w: 40, h: 60 });
    const gap = LINE.GAP + 10; // 26 px, under 0.5 × 60
    const bar = pen({ x: 120, y: 160 + gap, w: 120, h: 4 });
    const den = pen({ x: 130, y: 164 + 2 * gap, w: 90, h: 60 });
    expect(write([num, bar, den]).rows).toHaveLength(1);
    const small = pen({ x: 150, y: 400, w: 20, h: 20 });
    const farBar = pen({ x: 120, y: 420 + LINE.GAP + 1, w: 120, h: 4 }); // small writing: the fixed gap applies
    expect(write([small, farBar]).rows).toHaveLength(2);
  });

  it("a tall integral, a superscript and a subscript join their line", () => {
    const x = pen({ x: 160, y: 120, w: 25, h: 25 });
    const integral = pen({ x: 100, y: 90, w: 30, h: 90 });
    const sup = pen({ x: 188, y: 108, w: 10, h: 14 });
    const sub = pen({ x: 188, y: 140, w: 10, h: 14 });
    const state = write([x, integral, sup, sub]);
    expect(state.rows).toHaveLength(1);
  });

  it("a new line started just below the previous one (gap > LINE.GAP) is a new row", () => {
    const a = pen({ x: 100, y: 120, w: 300, h: 30 });
    const b = pen({ x: 100, y: 150 + LINE.GAP + 1, w: 40, h: 30 });
    expect(write([a, b]).rows).toHaveLength(2);
  });

  it("a line written between two lines takes index 2; ids stay the same", () => {
    const top = pen({ x: 100, y: 120, w: 40, h: 30 });
    const bottom = pen({ x: 100, y: 320, w: 40, h: 30 });
    const before = write([top, bottom]);
    const middle = pen({ x: 100, y: 220, w: 40, h: 30 });
    const after = reduceSessionEvent(before, { type: "stroke_end", at: middle.t1, stroke: middle });
    expect([rowOf(after, top.id), rowOf(after, bottom.id), rowOf(after, middle.id)]).toEqual(["p1/r1", "p1/r2", "p1/r3"]);
    expect([indexOf(after, top.id), indexOf(after, middle.id), indexOf(after, bottom.id)]).toEqual([1, 2, 3]);
  });

  it("a fully erased line keeps its row for undo but drops behind lines with ink; numbers are never reused", () => {
    const top = pen({ x: 100, y: 120, w: 40, h: 30 }), bottom = pen({ x: 100, y: 220, w: 40, h: 30 });
    const erased = reduceSessionEvent(write([top, bottom]), { type: "erase", at: 9000, strokeIds: [top.id], rowId: "p1/r1" });
    expect(erased.rows.map((r) => [r.id, r.index])).toEqual([["p1/r2", 1], ["p1/r1", 2]]);
    const undone = reduceSessionEvent(erased, { type: "undo", at: 9100, strokeIds: [top.id], rowId: "p1/r1" });
    expect(undone.rows.map((r) => [r.id, r.index])).toEqual([["p1/r1", 1], ["p1/r2", 2]]);
    const fresh = pen({ x: 100, y: 420, w: 40, h: 30 });
    expect(rowOf(reduceSessionEvent(erased, { type: "stroke_end", at: fresh.t1, stroke: fresh }), fresh.id)).toBe("p1/r3");
  });

  it("ignores another problem's strokes and erased strokes when assigning", () => {
    const other = pen({ x: 100, y: 120, w: 40, h: 30 }, { problemId: "p2", rowId: "p2/r1" });
    const gone = pen({ x: 100, y: 120, w: 40, h: 30 }, { rowId: "p1/r1", erasedAt: 10 });
    expect(assignLine(pen({ x: 160, y: 125, w: 20, h: 20 }), [other, gone])).toBe("p1/r2");
  });

  it("row boxes span the student column around the line's ink, padded by LINE.PAD", () => {
    const state = write([pen({ x: 100, y: 120, w: 40, h: 30 })]);
    expect(state.rows[0]!.bbox).toEqual({ x: PAGE.studentCol.x, y: 120 - LINE.PAD, w: PAGE.studentCol.w, h: 30 + 2 * LINE.PAD });
    expect(lineRows(["p1"], [])).toEqual([]);
  });

  it("keeps a blank page to start and two line heights below the lowest ink", () => {
    expect(freeSurfaceHeight([])).toBe(PAGE.statementMinHeight + 4 * PAGE.rowHeight);
    const deep = write([pen({ x: 100, y: 900, w: 40, h: 30 })]);
    expect(freeSurfaceHeight(deep.rows)).toBe(938 + 2 * PAGE.rowHeight);
  });

  it("clusters follow inferred lines", () => {
    const state = write([pen({ x: 100, y: 120, w: 20, h: 20 }), pen({ x: 200, y: 122, w: 20, h: 20 })]);
    expect(state.clusters["p1/r1"]!.map((c) => c.label)).toEqual([1, 2]);
  });
});

describe("free-layout recordings (P2.5a-AC2)", () => {
  it("export then replay gives the same rows, rowIds and clusters", () => {
    let state = write([pen({ x: 100, y: 120, w: 40, h: 30 }), pen({ x: 100, y: 220, w: 40, h: 30 }), pen({ x: 150, y: 125, w: 20, h: 20 })]);
    state = reduceSessionEvent(state, { type: "erase", at: 9000, strokeIds: [state.strokes[1]!.id], rowId: state.strokes[1]!.rowId! });
    const rec = exportRecording(state, "free");
    expect(rec.layout).toBe("free");
    const replayed = parseRecording(JSON.parse(JSON.stringify(rec))).events
      .reduce(reduceSessionEvent, createSessionState(rec.problems, rec.worksheetId, rec.rows, "free"));
    expect(replayed.rows).toEqual(state.rows);
    expect(replayed.strokes).toEqual(state.strokes);
    expect(replayed.clusters).toEqual(state.clusters);
  });

  it("a free recording may have a problem without any rows; a ruled one may not", () => {
    const state = write([pen({ x: 100, y: 120, w: 40, h: 30 })], ["p1", "p2"]);
    expect(() => exportRecording(state, "free")).not.toThrow();
    const ruled = { ...exportRecording(state, "free"), layout: undefined };
    expect(() => parseRecording(ruled)).toThrow();
  });
});
