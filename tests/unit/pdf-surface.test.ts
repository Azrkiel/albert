import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Stroke } from "../../src/lib/contracts";
import { createSessionState, reduceSessionEvent, listClusters, type SessionState } from "../../src/lib/canvas/store";
import { eraseGesture, historyEvent } from "../../src/lib/canvas/erase";
import { exportRecording, parseRecording, Replayer } from "../../src/lib/canvas/recording";
import { pageHeight, pageToLogical, logicalToPage, problemForStroke, pdfNoteBand } from "../../src/lib/canvas/pdf-pages";
import { planSnapshot } from "../../src/lib/canvas/snapshot";
import { buildHintRequest } from "../../src/lib/canvas/hint-request";

const page = { page: 1, widthPt: 612, heightPt: 792 };
function stroke(id: string, page = 1, problemId = "p1", x = 1100): Stroke {
  return { id, page, problemId, rowId: null, tool: "pen", pointerType: "pen", t0: 10, t1: 20,
    points: [{ x, y: 300, t: 10, p: 0.5 }, { x: x + 50, y: 320, t: 20, p: 0.5 }], bbox: { x, y: 300, w: 50, h: 20 } };
}
const initial = (): SessionState => ({ ...createSessionState(["p1", "p2"], "pdf", undefined, "free"), surface: "pdf", fileId: "synthetic.pdf" });
function add(state: SessionState, s: Stroke) { return reduceSessionEvent(state, { type: "stroke_end", at: 20, stroke: s }); }
function edit(state: SessionState, direction: "undo" | "redo", page: number) {
  const event = historyEvent(state, direction, 30, page);
  return event ? reduceSessionEvent(state, event) : state;
}
const region = (id: string, page: number, y: number, h: number) => ({ id, region: { page, bbox: { x: 0, y, w: 1200, h } } });

describe("PDF page geometry and ownership", () => {
  it("converts displayed points both ways, including the full page corners", () => {
    expect(pageHeight(page)).toBeCloseTo(1552.941176);
    for (const point of [{ x: 0, y: 0 }, { x: 612, y: 792 }, { x: 306, y: 396 }]) {
      const logical = pageToLogical(point, page);
      expect(logicalToPage(logical, page)).toEqual(point);
    }
    expect(pdfNoteBand(pageHeight(page))).toBeGreaterThan(pageHeight(page));
  });
  it("uses ink length, not sample count, and ignores another page's regions", () => {
    const s = stroke("a");
    s.points = [0, 10, 20, 30, 40, 50, 60, 70, 300].map(y => ({ x: 100, y, p: 0.5, t: y }));
    expect(problemForStroke(s, [region("p1", 1, 0, 100), region("p2", 1, 100, 300), region("wrong", 2, 0, 900)], "fallback")).toBe("p2");
  });
  it("falls back to the picker in unlabelled whitespace, and handles a tap", () => {
    expect(problemForStroke(stroke("a"), [region("p2", 2, 0, 900)], "picked")).toBe("picked");
    expect(problemForStroke({ page: 1, points: [{ x: 100, y: 50, t: 0, p: 0.5 }] }, [region("p2", 1, 0, 100)], "picked")).toBe("p2");
  });
  it("assigns separate stable full-width lines for the same problem and coordinates on different pages", () => {
    const state = add(add(add(initial(), stroke("a")), stroke("b", 2)), stroke("c", 1, "p2"));
    expect(state.rows.map(r => [r.id, r.page, r.bbox.w])).toEqual([
      ["p1/page1/r1", 1, 1200], ["p2/page1/r1", 1, 1200], ["p1/page2/r1", 2, 1200],
    ]);
    expect(listClusters(state)).toHaveLength(3);
  });
  it("never reuses a line id after its ink is erased", () => {
    let state = edit(add(initial(), stroke("a")), "undo", 1);
    state = add(state, stroke("b"));
    expect(state.strokes.map(s => s.rowId)).toEqual(["p1/page1/r1", "p1/page1/r2"]);
  });
});

describe("PDF page-scoped erase and history", () => {
  it("erases all intersected problems on the chosen page including the right edge", () => {
    const before = add(add(add(initial(), stroke("a")), stroke("b", 2)), stroke("c", 1, "p2"));
    const events = eraseGesture(before, "p2", [{ x: 1120, y: 308 }], 30, 1);
    const after = events.reduce(reduceSessionEvent, before);
    expect(after.strokes.map(s => s.erasedAt)).toEqual([30, undefined, 30]);
    expect(before.strokes.every(s => s.erasedAt === undefined)).toBe(true);
    expect(eraseGesture(before, "p1", [{ x: 1120, y: 308 }], 30)).toEqual([]);
  });
  it("undo/redo selects the active page even when the other page was edited last", () => {
    const state = add(add(initial(), stroke("a")), stroke("b", 2));
    const undone = edit(state, "undo", 1);
    expect(undone.strokes.map(s => s.erasedAt)).toEqual([30, undefined]);
    expect(edit(undone, "redo", 1).strokes).toEqual(state.strokes);
    expect(edit(undone, "undo", 1)).toBe(undone);
  });
  it("new ink invalidates only that page's redo stack", () => {
    let state = add(add(initial(), stroke("a")), stroke("b", 2));
    state = edit(edit(state, "undo", 1), "undo", 2);
    state = add(state, stroke("c", 2));
    expect(historyEvent(state, "redo", 30, 2)).toBeNull();
    expect(historyEvent(state, "redo", 30, 1)?.type).toBe("undo");
    expect(edit(state, "redo", 1).strokes[0]!.erasedAt).toBeUndefined();
  });
  it("undoing an erase restores the same id/points without touching the other page", () => {
    const before = add(add(initial(), stroke("a")), stroke("b", 2));
    const erased = eraseGesture(before, "p2", [{ x: 1120, y: 308 }], 30, 1).reduce(reduceSessionEvent, before);
    expect(edit(erased, "undo", 1).strokes).toEqual(before.strokes);
  });
  it("exports/replays pages, line ids and both history stacks exactly", () => {
    const before = edit(add(add(initial(), stroke("a")), stroke("b", 2)), "undo", 1);
    const recording = exportRecording(before, "synthetic");
    let after = initial();
    new Replayer(recording, e => { after = reduceSessionEvent(after, e); }).seek(recording.durationMs);
    expect(after.strokes).toEqual(before.strokes);
    expect(after.rows).toEqual(before.rows);
    expect(after.undoStack).toEqual(before.undoStack);
    expect(after.redoStack).toEqual(before.redoStack);
  });
  it("accepts the labelled synthetic PDF fixture and rejects missing page/file identity", () => {
    const raw = JSON.parse(readFileSync("fixtures/sessions/pdf-synthetic.json", "utf8"));
    expect(parseRecording(raw).surface).toBe("pdf");
    expect(() => parseRecording({ ...raw, fileId: undefined })).toThrow();
    const missing = structuredClone(raw);
    delete missing.events[0].stroke.page;
    expect(() => parseRecording(missing)).toThrow();
  });
});

describe("PDF snapshot plan", () => {
  it("includes the problem's grey crop at the same page offset and only the targeted page's ink", async () => {
    const state = add(add(initial(), stroke("a")), stroke("b", 2));
    const background = { src: "/page/2", page: 2, width: 1200, height: pageHeight(page), crop: { x: 0, y: 200, w: 1200, h: 500 } };
    const args = { strokes: state.strokes, rows: state.rows, clusters: listClusters(state), problemId: "p1", upToRowId: "p1/page2/r1", background };
    const plan = planSnapshot(args);
    expect(plan.background).toEqual(background);
    expect(plan.crop).toEqual({ x: -24, y: 176, w: 1248, h: 548 });
    expect(plan.strokes.map(s => s.id)).toEqual(["b"]);
    const rendered: unknown[] = [];
    await buildHintRequest(state, args.upToRowId, 1, "manual", { background, render: async args => {
      rendered.push(args.background);
      return { png: "synthetic", width: 100, height: 100, rows: plan.rows };
    } });
    expect(rendered).toEqual([background]);
  });
});
