import { describe, expect, it } from "vitest";
import { PAGE, SessionEventSchema, type Stroke } from "../../src/lib/contracts";
import { addCompletedStroke, createSessionState, reduceSessionEvent } from "../../src/lib/canvas/store";
import { clearRow, eraseGesture, historyEvent } from "../../src/lib/canvas/erase";
import { exportRecording, parseRecording, Replayer } from "../../src/lib/canvas/recording";

// Synthetic geometry, not human handwriting.
function ink(id: string, row = 1, x = 100): Stroke {
  const y = PAGE.statementMinHeight + (row - 1) * PAGE.rowHeight + 30;
  return { id, problemId: "p1", rowId: null, tool: "pen", pointerType: "pen",
    points: [{ x, y, t: 10, p: 0.5 }, { x: x + 100, y, t: 20, p: 0.5 }],
    t0: 10, t1: 20, bbox: { x, y, w: 100, h: 0 } };
}
function written() {
  let state = createSessionState(["p1", "p2"], "worksheet");
  for (const stroke of [ink("a"), ink("b", 1, 240), ink("c", 2)]) state = addCompletedStroke(state, "p1", stroke);
  return addCompletedStroke(state, "p2", ink("d"));
}
const gesture = [{ x: 150, y: 100 }, { x: 150, y: 260 }];

describe("erase (P2.4-AC1)", () => {
  it("marks intersected whole strokes at the supplied time, one event per affected row", () => {
    const before = written();
    const events = eraseGesture(before, "p1", gesture, 50);
    expect(events).toEqual([
      { type: "erase", at: 50, strokeIds: ["a"], rowId: "p1/r1" },
      { type: "erase", at: 50, strokeIds: ["c"], rowId: "p1/r2" },
    ]);
    const after = events.reduce(reduceSessionEvent, before);
    expect(after.strokes.map((s) => s.erasedAt)).toEqual([50, undefined, 50, undefined]);
    expect(after.strokes.map((s) => s.points)).toEqual(before.strokes.map((s) => s.points));
    expect(after.rows).toEqual(before.rows);
    expect(before.strokes.every((s) => s.erasedAt === undefined)).toBe(true);
    expect(after.events[0]).toEqual(before.events[0]);
  });

  it("Clear row emits one erase event for only the row's live ink; empty clears are no-ops", () => {
    const before = written();
    const event = clearRow(before, "p1/r1", 60)!;
    expect(event).toEqual({ type: "erase", at: 60, strokeIds: ["a", "b"], rowId: "p1/r1" });
    const after = reduceSessionEvent(before, event);
    expect(after.events).toHaveLength(before.events.length + 1);
    expect(after.strokes.map((s) => s.erasedAt)).toEqual([60, 60, undefined, undefined]);
    expect(clearRow(after, "p1/r1", 70)).toBeNull();
    expect(clearRow(after, "missing", 70)).toBeNull();
    expect(eraseGesture(after, "p1", [{ x: 150, y: 126 }], 70)).toEqual([]);
  });

  it("a repeated sweep across two strokes in one row produces exactly one event", () => {
    const events = eraseGesture(written(), "p1", [
      { x: 80, y: 126 }, { x: 360, y: 126 }, { x: 80, y: 126 },
    ], 50);
    expect(events).toEqual([{ type: "erase", at: 50, strokeIds: ["a", "b"], rowId: "p1/r1" }]);
  });

  it("tests line segments, taps, and the visible column rather than bounding boxes alone", () => {
    const before = addCompletedStroke(createSessionState(["p1"]), "p1", {
      ...ink("diagonal"), points: [{ x: 100, y: 110, t: 10, p: 0.5 }, { x: 200, y: 190, t: 20, p: 0.5 }],
      bbox: { x: 100, y: 110, w: 100, h: 80 },
    });
    expect(eraseGesture(before, "p1", [{ x: 150, y: 150 }], 50)).toHaveLength(1);
    expect(eraseGesture(before, "p1", [{ x: 105, y: 185 }], 50)).toEqual([]);
    expect(eraseGesture(before, "p1", [], 50)).toEqual([]);
    const outside = addCompletedStroke(createSessionState(["p1"]), "p1", ink("outside", 1, 850));
    expect(eraseGesture(outside, "p1", [{ x: 900, y: 126 }], 50)).toEqual([]);
  });

  it("rejects cross-row references atomically instead of erasing another problem", () => {
    expect(() => reduceSessionEvent(written(), { type: "erase", at: 40, strokeIds: ["a", "d"], rowId: "p1/r1" })).toThrow();
    expect(() => reduceSessionEvent(written(), { type: "erase", at: 40, strokeIds: ["missing"], rowId: "p1/r1" })).toThrow();
  });
});

describe("undo and redo (P2.4-AC2/AC3)", () => {
  it("undo emits the canonical event, then redo restores the same stroke ID and original points/timing", () => {
    const before = written();
    const undo = historyEvent(before, "undo", 50)!;
    expect(undo).toEqual({ type: "undo", at: 50, strokeIds: ["d"], rowId: "p2/r1" });
    let state = reduceSessionEvent(before, undo);
    expect(state.strokes.at(-1)?.erasedAt).toBe(50);
    const redo = historyEvent(state, "redo", 60)!;
    expect(redo).toEqual({ type: "undo", redo: true, at: 60, strokeIds: ["d"], rowId: "p2/r1" });
    expect(SessionEventSchema.parse(redo)).toEqual(redo);
    state = reduceSessionEvent(state, redo);
    expect(state.strokes).toEqual(before.strokes);
    expect(state.events.slice(-2)).toEqual([undo, redo]);
    expect(historyEvent(state, "redo", 70)).toBeNull();
  });

  it("undo/redo applies to grouped erases and Clear row, and new edits discard redo", () => {
    let state = written();
    state = reduceSessionEvent(state, clearRow(state, "p1/r1", 30)!);
    state = reduceSessionEvent(state, historyEvent(state, "undo", 40)!);
    expect(state.strokes.every((s) => s.erasedAt === undefined)).toBe(true);
    state = reduceSessionEvent(state, historyEvent(state, "redo", 50)!);
    expect(state.strokes.slice(0, 2).map((s) => s.erasedAt)).toEqual([50, 50]);
    state = reduceSessionEvent(state, historyEvent(state, "undo", 60)!);
    state = reduceSessionEvent(state, historyEvent(state, "undo", 70)!);
    expect(state.strokes.at(-1)?.erasedAt).toBe(70);
    state = reduceSessionEvent(state, historyEvent(state, "redo", 80)!);
    expect(state.strokes.at(-1)).toEqual(written().strokes.at(-1));
    state = addCompletedStroke(state, "p1", { ...ink("new"), t0: 90, t1: 100,
      points: ink("new").points.map((p, i) => ({ ...p, t: 90 + i * 10 })) });
    expect(historyEvent(state, "redo", 110)).toBeNull();
    expect(historyEvent(createSessionState(["p1"]), "undo", 1)).toBeNull();
  });

  it("undoing last-row ink retains grown rows and redoing preserves the original stroke", () => {
    const before = addCompletedStroke(createSessionState(["p1", "p2"]), "p1", ink("last-row", 4));
    expect(before.rows.filter((row) => row.problemId === "p1")).toHaveLength(5);
    let state = reduceSessionEvent(before, historyEvent(before, "undo", 30)!);
    expect(state.rows).toEqual(before.rows);
    state = reduceSessionEvent(state, historyEvent(state, "redo", 40)!);
    expect(state.rows).toEqual(before.rows);
    expect(state.strokes).toEqual(before.strokes);
  });

  it("export then replay preserves erased state, undo/redo stacks, IDs, rows and timing at every prefix", () => {
    let state = written();
    const prefixes = [state];
    for (const action of ["erase", "undo", "redo", "undo", "undo", "redo"] as const) {
      const at = 30 + prefixes.length * 10;
      const event = action === "erase" ? clearRow(state, "p1/r1", at)! : historyEvent(state, action, at)!;
      state = reduceSessionEvent(state, event);
      prefixes.push(state);
    }
    for (const original of prefixes) {
      const rec = exportRecording(original, "synthetic-erase-undo-redo");
      let replayed = createSessionState(rec.problems, rec.worksheetId, rec.rows);
      new Replayer(rec, (event) => { replayed = reduceSessionEvent(replayed, event); }).seek(Infinity);
      expect(replayed).toEqual(original);
      expect(historyEvent(replayed, "undo", 200)).toEqual(historyEvent(original, "undo", 200));
      expect(historyEvent(replayed, "redo", 200)).toEqual(historyEvent(original, "redo", 200));
    }
  });

  it("rejects malformed undo/redo targets before loading a recording", () => {
    const rec = exportRecording(written(), "bad-edit");
    for (const edit of [
      { type: "erase", at: 40, strokeIds: ["d"], rowId: "p1/r1" },
      { type: "undo", at: 40, strokeIds: ["a"], rowId: "p1/r1" },
      { type: "undo", redo: true, at: 40, strokeIds: ["d"], rowId: "p2/r1" },
    ]) expect(() => parseRecording({ ...rec, durationMs: 40, events: [...rec.events, edit] })).toThrow();
  });
});
