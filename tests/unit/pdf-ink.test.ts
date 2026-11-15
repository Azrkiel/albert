import { readFileSync } from "node:fs";
import { parseRecording, exportRecording } from "../../src/lib/canvas/recording";
import { describe, expect, it } from "vitest";
import { StrokeSchema, type Stroke } from "../../src/lib/contracts";
import { createSessionState, reduceSessionEvent, listClusters } from "../../src/lib/canvas/store";
import { eraseGesture, historyEvent } from "../../src/lib/canvas/erase";
import { planSnapshot } from "../../src/lib/canvas/snapshot";
import { problemForStroke } from "../../src/lib/canvas/pdf-page";

const pen = (id: string, page: number, problemId = "p1"): Stroke => StrokeSchema.parse({
  id, page, problemId, rowId: null, tool: "pen", pointerType: "mouse", t0: 0, t1: 10,
  points: [{ x: 1000, y: 100, p: .5, t: 0 }, { x: 1020, y: 120, p: .5, t: 10 }],
  bbox: { x: 1000, y: 100, w: 20, h: 20 },
});
const write = (state: ReturnType<typeof createSessionState>, stroke: Stroke) => reduceSessionEvent(state, { type: "stroke_end", at: 10, stroke });

describe("PDF page ink", () => {
  it("round-trips a page-aware recording without dropping its source", () => {
    const rec = parseRecording(JSON.parse(readFileSync("fixtures/sessions/pdf-two-pages.json", "utf8")));
    let state = createSessionState(rec.problems, rec.worksheetId, rec.rows, "free");
    for (const event of rec.events) state = reduceSessionEvent(state, event);
    const result = exportRecording({ ...state, surface: "pdf", fileId: rec.fileId, durationMs: rec.durationMs }, rec.name);
    expect(result).toEqual(rec);
  });
  it("preserves page identity and partitions identical writing on different pages", () => {
    let state = createSessionState(["p1"], "pdf", undefined, "free");
    state = write(write(state, pen("a", 1)), pen("b", 2));
    expect(state.strokes.map(s => s.page)).toEqual([1, 2]);
    expect(new Set(state.strokes.map(s => s.rowId)).size).toBe(2);
    expect(state.rows.map(r => r.page)).toEqual([1, 2]);
    expect(state.rows.every(r => r.bbox.x + r.bbox.w >= 1020)).toBe(true);
  });
  it("erases across problems only on the gesture page and undoes per page", () => {
    let state = createSessionState(["p1", "p2"], "pdf", undefined, "free");
    state = write(write(state, pen("a", 1, "p2")), pen("b", 2));
    const edits = eraseGesture(state, "p1", pen("e", 1).points, 20, 1);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ strokeIds: ["a"] });
    const undo = historyEvent(state, "undo", 20, 1)!;
    expect(undo).toMatchObject({ strokeIds: ["a"] });
    state = reduceSessionEvent(state, undo);
    expect(state.strokes.find(s => s.id === "a")?.erasedAt).toBe(20);
    expect(state.strokes.find(s => s.id === "b")?.erasedAt).toBeUndefined();
    expect(historyEvent(state, "redo", 30, 1)).toMatchObject({ strokeIds: ["a"], redo: true });
  });
  it("includes the printed problem crop and excludes another page from snapshots", () => {
    const state = write(write(createSessionState(["p1"], "pdf", undefined, "free"), pen("a", 1)), pen("b", 2));
    const background = { page: 1, url: "/page/1", width: 1200, height: 1600, region: { x: 0, y: 60, w: 1200, h: 300 } };
    const plan = planSnapshot({ strokes: state.strokes, rows: state.rows, clusters: listClusters(state), problemId: "p1", upToRowId: state.strokes[0]!.rowId!, background });
    expect(plan.strokes.map(s => s.id)).toEqual(["a"]);
    expect(plan.background).toEqual(background);
    expect(plan.crop.x).toBeLessThanOrEqual(0);
    expect(plan.crop.y + plan.crop.h).toBeGreaterThanOrEqual(360);
  });
  it("assigns the region containing most ink and falls back to the picker", () => {
    const problems = [{ id: "p1", region: { page: 1, bbox: { x: 0, y: 0, w: 1200, h: 200 } } }, { id: "p2", region: { page: 2, bbox: { x: 0, y: 0, w: 1200, h: 200 } } }];
    expect(problemForStroke(pen("a", 2), problems, "p1")).toBe("p2");
    expect(problemForStroke({ ...pen("a", 3) }, problems, "p1")).toBe("p1");
  });
});
