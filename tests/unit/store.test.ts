import { describe, expect, it } from "vitest";
import { PAGE, type Stroke } from "../../src/lib/contracts";
import { createSessionState, listClusters, reduceSessionEvent, type SessionState } from "../../src/lib/canvas";
import { reclusterChanged } from "../../src/lib/canvas/store";

const rowY = (index: number) => PAGE.statementMinHeight + (index - 1) * PAGE.rowHeight + 20;

function pen(id: string, row: number, x: number, t: number): Stroke {
  const y = rowY(row);
  return { id, problemId: "p1", rowId: null, tool: "pen", pointerType: "mouse",
    points: [{ x, y, t, p: 0.5 }, { x: x + 20, y: y + 20, t: t + 10, p: 0.5 }],
    t0: t, t1: t + 10, bbox: { x, y, w: 20, h: 20 } };
}

function write(state: SessionState, stroke: Stroke): SessionState {
  return reduceSessionEvent(state, { type: "stroke_end", at: stroke.t1, stroke });
}

function session(): SessionState {
  let state = createSessionState(["p1"]);
  state = write(state, pen("a", 1, 100, 0));
  state = write(state, pen("b", 1, 200, 100));
  state = write(state, pen("c", 2, 100, 200));
  return state;
}

describe("session store clusters (P2.5)", () => {
  it("clusters each row as strokes end", () => {
    const state = session();
    expect(state.clusters["p1/r1"]!.map((c) => c.strokeIds)).toEqual([["a"], ["b"]]);
    expect(state.clusters["p1/r2"]!.map((c) => c.strokeIds)).toEqual([["c"]]);
    expect(listClusters(state).map((c) => c.id)).toEqual(["p1/r1/c1", "p1/r1/c2", "p1/r2/c1"]);
    expect(listClusters(state, ["p1/r2"]).map((c) => c.id)).toEqual(["p1/r2/c1"]);
  });

  it("a new stroke recomputes only its own row", () => {
    const before = session();
    const after = write(before, pen("d", 2, 115, 300)); // overlaps "c"
    expect(after.clusters["p1/r1"]).toBe(before.clusters["p1/r1"]);
    expect(after.clusters["p1/r2"]!.map((c) => c.strokeIds)).toEqual([["c", "d"]]);
  });

  it("erase stamps erasedAt and recomputes only that row's clusters", () => {
    const before = session();
    const after = reduceSessionEvent(before, { type: "erase", at: 5000, strokeIds: ["a"], rowId: "p1/r1" });
    expect(after.strokes.find((s) => s.id === "a")!.erasedAt).toBe(5000);
    expect(after.strokes).toHaveLength(3);
    expect(after.clusters["p1/r1"]!.map((c) => [c.id, c.strokeIds])).toEqual([["p1/r1/c1", ["b"]]]);
    expect(after.clusters["p1/r2"]).toBe(before.clusters["p1/r2"]);
  });

  it("undo and redo (P2.4 semantics) recompute only the undone stroke's row", () => {
    const before = session(); // the last draw is "c" in row 2
    const undone = reduceSessionEvent(before, { type: "undo", at: 5000, strokeIds: ["c"], rowId: "p1/r2" });
    expect(undone.clusters["p1/r2"]).toEqual([]);
    expect(undone.clusters["p1/r1"]).toBe(before.clusters["p1/r1"]);
    const redone = reduceSessionEvent(undone, { type: "undo", redo: true, at: 6000, strokeIds: ["c"], rowId: "p1/r2" });
    expect(redone.clusters["p1/r2"]).toEqual(before.clusters["p1/r2"]);
    expect(redone.clusters["p1/r1"]).toBe(before.clusters["p1/r1"]);
  });

  it("reclusterChanged follows any stroke change, independent of the event that caused it", () => {
    const erased = reduceSessionEvent(session(), { type: "erase", at: 5000, strokeIds: ["a"], rowId: "p1/r1" });
    const restoredStrokes = erased.strokes.map((s) => {
      if (s.id !== "a") return s;
      const copy = { ...s };
      delete copy.erasedAt;
      return copy;
    });
    const restored = reclusterChanged(erased, { ...erased, strokes: restoredStrokes });
    expect(restored.clusters["p1/r1"]!.map((c) => c.strokeIds)).toEqual([["a"], ["b"]]);
    expect(restored.clusters["p1/r2"]).toBe(erased.clusters["p1/r2"]);
    expect(reclusterChanged(erased, { ...erased })).toEqual(erased);
  });

  it("replaying the same events rebuilds the same clusters", () => {
    const live = reduceSessionEvent(session(), { type: "erase", at: 5000, strokeIds: ["b"], rowId: "p1/r1" });
    const replayed = live.events.reduce(reduceSessionEvent, createSessionState(["p1"]));
    expect(replayed.clusters).toEqual(live.clusters);
    expect(replayed.strokes).toEqual(live.strokes);
  });
});
