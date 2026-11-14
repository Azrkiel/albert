import { describe, expect, it } from "vitest";
import { STUCK, type Cluster, type Row, type SessionEvent, type Stroke, type StuckSignal } from "../../src/lib/contracts";
import { createSessionState, exportRecording, listClusters, reduceSessionEvent } from "../../src/lib/canvas";
import { crossOutClusterIds, detectStuck } from "../../src/lib/canvas/stuck";

const row = (id = "p/r1", y = 200, h = 128): Row => ({ id, problemId: "p", index: 1, bbox: { x: 0, y, w: 760, h } });
function pen(id: string, at: number, rowId = "p/r1", x = 100): Stroke {
  return { id, problemId: "p", rowId, tool: "pen", pointerType: "mouse", t0: at - 20, t1: at,
    bbox: { x, y: 220, w: 20, h: 20 }, points: [{ x, y: 220, t: at - 20, p: 0.5 }, { x: x + 20, y: 240, t: at, p: 0.5 }] };
}
const end = (stroke: Stroke): SessionEvent => ({ type: "stroke_end", at: stroke.t1, stroke });
const cluster = (stroke: Stroke): Cluster => ({ id: `${stroke.rowId}/c1`, rowId: stroke.rowId!, label: 1, strokeIds: [stroke.id], bbox: stroke.bbox });
function writer(gap = 400, count = 5) {
  const strokes = Array.from({ length: count }, (_, i) => pen(`s${i}`, 100 + i * (gap + 20)));
  return { events: strokes.map(end), strokes, last: strokes.at(-1)!.t1, clusters: strokes.map(cluster) };
}
const stuck = (signal: StuckSignal): SessionEvent => ({ type: "stuck", at: signal.at, signal });

describe("P2.6-AC1: stuck detection", () => {
  it("a pause just under and just over the threshold", () => {
    const w = writer();
    expect(detectStuck(w.events, w.last + STUCK.PAUSE_MIN_MS - 1, [row()], w.clusters)).toBeNull();
    expect(detectStuck(w.events, w.last + STUCK.PAUSE_MIN_MS + 1, [row()], w.clusters)).toMatchObject({ kind: "pause", rowId: "p/r1" });
  });
  it("a fast writer (median gap 400 ms → threshold is the 8 s floor)", () => {
    const w = writer();
    expect(detectStuck(w.events, w.last + 8001, [row()], w.clusters)?.detail?.pauseMs).toBe(8001);
  });
  it("a slow one (median 6 s → threshold 15 s)", () => {
    const w = writer(6000);
    expect(detectStuck(w.events, w.last + 14999, [row()], w.clusters)).toBeNull();
    expect(detectStuck(w.events, w.last + 15001, [row()], w.clusters)?.kind).toBe("pause");
  });
  it("fewer than five strokes use PAUSE_MAX_MS, and very slow writers clamp to it", () => {
    for (const w of [writer(400, 4), writer(20000)]) {
      expect(detectStuck(w.events, w.last + STUCK.PAUSE_MAX_MS - 1, [row()], w.clusters)).toBeNull();
      expect(detectStuck(w.events, w.last + STUCK.PAUSE_MAX_MS + 1, [row()], w.clusters)?.kind).toBe("pause");
    }
  });
  it("two erases in 30 s (fires) and in 60 s (does not)", () => {
    const erase = (at: number): SessionEvent => ({ type: "erase", at, strokeIds: ["s"], rowId: "p/r1" });
    expect(detectStuck([erase(100), erase(30100)], 30100, [row()], [])).toMatchObject({ kind: "erase_loop", detail: { eraseCount: 2 } });
    expect(detectStuck([erase(100), erase(60100)], 60100, [row()], [])).toBeNull();
  });
  it("undo counts, redo does not; other rows and stale edits do not combine", () => {
    const undo: SessionEvent = { type: "undo", at: 100, strokeIds: ["a"], rowId: "p/r1" };
    const erase: SessionEvent = { type: "erase", at: 200, strokeIds: ["b"], rowId: "p/r1" };
    expect(detectStuck([undo, erase], 200, [row()], [])?.kind).toBe("erase_loop");
    expect(detectStuck([{ ...undo, redo: true }, erase], 200, [row()], [])).toBeNull();
    expect(detectStuck([undo, { ...erase, rowId: "p/r2" }], 200, [row(), row("p/r2")], [])).toBeNull();
    expect(detectStuck([undo, erase], 50000, [row()], [])).toBeNull();
    expect(detectStuck([undo, erase, end(pen("new", 300))], 300, [row()], [cluster(pen("new", 300))])).toBeNull();
  });
  it("a scribble over 80% of a row (fires) and a short underline (does not)", () => {
    const old = pen("old", 100);
    old.bbox = { x: 100, y: 220, w: 200, h: 40 };
    const scribble = pen("scribble", 300);
    scribble.bbox = { x: 100, y: 220, w: 160, h: 40 };
    scribble.points = [[100, 220], [260, 260], [100, 260], [260, 220]].map(([x, y], i) => ({ x: x!, y: y!, t: 280 + i * 6, p: 0.5 }));
    expect(crossOutClusterIds(scribble, [cluster(old)])).toEqual(["p/r1/c1"]);
    expect(detectStuck([end(old), end(scribble)], 300, [row()], [cluster(old)])).toMatchObject({ kind: "cross_out", detail: { crossedClusterIds: ["p/r1/c1"] } });
    const underline = pen("underline", 400);
    underline.bbox = { x: 100, y: 258, w: 40, h: 0 };
    expect(crossOutClusterIds(underline, [cluster(old)])).toEqual([]);
    expect(detectStuck([end(old), end(underline)], 400, [row()], [cluster(old), cluster(underline)])).toBeNull();
  });
  it("a solved problem (never fires)", () => {
    const w = writer();
    const checked: SessionEvent = { type: "check_result", at: w.last + 1, problemId: "p", verdict: "correct" };
    const events = [...w.events, checked];
    expect(detectStuck(events, w.last + 60000, [row()], w.clusters)).toBeNull();
    expect(detectStuck([...events, end(pen("later", w.last + 2))], w.last + 60000, [row()], w.clusters)).toBeNull();
    expect(detectStuck([...events, { ...checked, at: w.last + 3, verdict: "not_yet" }], w.last + 60000, [row()], w.clusters)?.kind).toBe("pause");
  });
  it("empty, erased, eraser-only and divider-only problems never pause; manual is not detected", () => {
    expect(detectStuck([], 60000, [row()], [])).toBeNull();
    expect(detectStuck(writer().events, 60000, [row()], [])).toBeNull();
    const eraser = { ...pen("eraser", 100), tool: "eraser" as const };
    expect(detectStuck([end(eraser)], 60000, [row()], [])).toBeNull();
  });
  it("uses the current problem and the last live ink by time, not row index", () => {
    const a = pen("a", 100, "p/r2");
    const b = pen("b", 300, "p/r1");
    expect(detectStuck([end(a), end(b)], 60000, [row(), row("p/r2", 500)], [cluster(a), cluster(b)])?.rowId).toBe("p/r1");
    expect(detectStuck([end(a), { type: "problem_opened", problemId: "other", at: 200 }], 60000, [row("p/r2")], [cluster(a)])).toBeNull();
  });
});

describe("P2.6-AC2: re-arm", () => {
  it("after a pause signal, calling again 30 s later returns null; after one new stroke and another pause it fires again", () => {
    const w = writer();
    const signal = detectStuck(w.events, w.last + 8001, [row()], w.clusters)!;
    const events = [...w.events, stuck(signal)];
    expect(detectStuck(events, signal.at + 30000, [row()], w.clusters)).toBeNull();
    const next = pen("new", signal.at + 30001, "p/r2");
    expect(detectStuck([...events, end(next)], next.t1 + 20001, [row(), row("p/r2")], [...w.clusters, cluster(next)])?.kind).toBe("pause");
  });
  it("new ink in the problem re-arms every row, even at equal timestamps", () => {
    const w = writer();
    const signal = detectStuck(w.events, w.last + 8001, [row()], w.clusters)!;
    const ink = pen("same-time", signal.at);
    expect(detectStuck([...w.events, stuck(signal), end(ink)], signal.at + 20001, [row()], [cluster(ink)])?.kind).toBe("pause");
    expect(detectStuck([...w.events, stuck(signal), { ...end(ink), stroke: { ...ink, tool: "eraser" } } as SessionEvent], signal.at + 60000, [row()], w.clusters)).toBeNull();
  });
});

for (const layout of ["free", "ruled"] as const) {
  it(`${layout} layout: row boxes and a stacked fraction use the same detector`, () => {
    let s = createSessionState(["p"], "w", undefined, layout);
    for (const [i, box] of [{ x: 100, y: 180, w: 20, h: 20 }, { x: 90, y: 210, w: 100, h: 1 }, { x: 100, y: 220, w: 20, h: 60 }].entries()) {
      const stroke = { ...pen(`f${i}`, 100 + i * 100), rowId: null, bbox: box,
        points: [{ x: box.x, y: box.y, t: 80 + i * 100, p: 0.5 }, { x: box.x + box.w, y: box.y + box.h, t: 100 + i * 100, p: 0.5 }] };
      s = reduceSessionEvent(s, end(stroke));
    }
    expect(detectStuck(s.events, 20301, s.rows, listClusters(s))).toMatchObject({ kind: "pause", rowId: s.strokes.at(-1)!.rowId });
    if (layout === "free") expect(new Set(s.strokes.map((st) => st.rowId)).size).toBe(1);
    const mark = detectStuck(s.events, 20301, s.rows, listClusters(s))!;
    s = reduceSessionEvent(s, stuck(mark));
    expect(s.stuckMarks.p).toEqual(mark);
    const replay = s.events.reduce(reduceSessionEvent, createSessionState(["p"], "w", undefined, layout));
    expect(replay).toEqual(s);
    s = reduceSessionEvent(s, end({ ...pen("fresh", 20400), rowId: null }));
    expect(s.stuckMarks.p).toBeUndefined();
  });
}

it("derived cross-out tags replay exactly, exclude the scribble from clusters and keep its ink", () => {
  let s = createSessionState(["p"]);
  s = reduceSessionEvent(s, end(pen("old", 100)));
  const scribble = pen("cross", 200);
  scribble.points = [[100, 220], [120, 240], [100, 240], [120, 220]].map(([x, y], i) => ({ x: x!, y: y!, t: 180 + i * (20 / 3), p: 0.5 }));
  s = reduceSessionEvent(s, end(scribble));
  expect(s.crossOuts.cross).toEqual(["p/r1/c1"]);
  expect(listClusters(s).flatMap((c) => c.strokeIds)).toEqual(["old"]);
  expect(s.strokes).toHaveLength(2);
  const recording = exportRecording(s, "synthetic cross-out unit case");
  expect(recording).not.toHaveProperty("crossOuts");
  expect(recording.events.reduce(reduceSessionEvent, createSessionState(["p"]))).toEqual(s);
});

it("a requested hint dismisses the mark and a correct check clears it; manual signals stay suppressed until ink", () => {
  let s = createSessionState(["p"]);
  const manual: StuckSignal = { kind: "manual", problemId: "p", rowId: "p/r1", at: 100 };
  s = reduceSessionEvent(s, stuck(manual));
  s = reduceSessionEvent(s, { type: "hint_requested", at: 100, hintId: "h", rowId: "p/r1", rung: 1 });
  expect(s.stuckMarks.p).toBeUndefined();
  s = reduceSessionEvent(s, stuck({ ...manual, at: 200 }));
  s = reduceSessionEvent(s, { type: "check_result", at: 300, problemId: "p", verdict: "correct" });
  expect(s.stuckMarks.p).toBeUndefined();
});

it("free lines: a later stroke in an upper line chooses its current bbox, not the bottom line", () => {
  let s = createSessionState(["p"], "w", undefined, "free");
  for (const [i, y] of [400, 200, 205].entries()) {
    const stroke = pen(`line${i}`, 100 + 100 * i);
    stroke.rowId = null;
    stroke.bbox.y = y;
    stroke.points = stroke.points.map((point, j) => ({ ...point, y: y + 20 * j }));
    s = reduceSessionEvent(s, end(stroke));
  }
  const signal = detectStuck(s.events, 20301, s.rows, listClusters(s))!;
  expect(s.rows).toHaveLength(2);
  expect(s.rows.find((r) => r.id === signal.rowId)).toMatchObject({ index: 1, bbox: { y: 192, h: 41 } });
});

it("cross-out tags survive undo/redo while their original pen strokes remain unmodified", () => {
  let s = createSessionState(["p"]);
  s = reduceSessionEvent(s, end(pen("old", 100)));
  const scribble = pen("cross", 200);
  scribble.points = [[100, 220], [120, 240], [100, 240], [120, 220]].map(([x, y], i) => ({ x: x!, y: y!, t: 180 + i * 6, p: 0.5 }));
  s = reduceSessionEvent(s, end(scribble));
  s = reduceSessionEvent(s, { type: "undo", at: 300, rowId: "p/r1", strokeIds: ["cross"] });
  s = reduceSessionEvent(s, { type: "undo", redo: true, at: 400, rowId: "p/r1", strokeIds: ["cross"] });
  expect(s.crossOuts.cross).toEqual(["p/r1/c1"]);
  expect(s.strokes[1]).toEqual(scribble);
  expect(listClusters(s).flatMap((c) => c.strokeIds)).toEqual(["old"]);
});
