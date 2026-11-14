import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE, type Stroke } from "../../src/lib/contracts";
import { createSessionState, listClusters, parseRecording, planSnapshot, reduceSessionEvent, Replayer, SNAPSHOT, type SessionState } from "../../src/lib/canvas";

const rowY = (index: number) => PAGE.statementMinHeight + (index - 1) * PAGE.rowHeight + 20;

function pen(id: string, row: number, x: number, t: number, w = 20): Stroke {
  const y = rowY(row);
  return { id, problemId: "p1", rowId: null, tool: "pen", pointerType: "mouse",
    points: [{ x, y, t, p: 0.5 }, { x: x + w, y: y + 20, t: t + 10, p: 0.5 }],
    t0: t, t1: t + 10, bbox: { x, y, w, h: 20 } };
}

function session(...strokes: Stroke[]): SessionState {
  return strokes.reduce((state, stroke) => reduceSessionEvent(state, { type: "stroke_end", at: stroke.t1, stroke }),
    createSessionState(["p1", "p2"]));
}

const plan = (state: SessionState, upToRowId: string, problemId = "p1") =>
  planSnapshot({ strokes: state.strokes, rows: state.rows, clusters: listClusters(state), problemId, upToRowId });

function replay(name: string): SessionState {
  const rec = parseRecording(JSON.parse(readFileSync(`fixtures/sessions/${name}.json`, "utf8")));
  let state = { ...createSessionState(rec.problems, rec.worksheetId, rec.rows, rec.layout ?? "ruled"), durationMs: rec.durationMs };
  new Replayer(rec, (event) => { state = reduceSessionEvent(state, event); }).seek(rec.durationMs);
  return state;
}

describe("planSnapshot (P2.7)", () => {
  it("crops to rows 1..upTo with padding at 2x and lists each inked row's cluster labels", () => {
    const state = session(pen("a", 1, 100, 0), pen("b", 1, 200, 100), pen("c", 2, 100, 200), pen("d", 3, 100, 300));
    const two = plan(state, "p1/r2");
    expect(two.rows).toEqual([
      { rowId: "p1/r1", index: 1, clusterLabels: [1, 2] },
      { rowId: "p1/r2", index: 2, clusterLabels: [1] },
    ]);
    expect(two.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(two.scale).toBe(SNAPSHOT.SCALE);
    const ink = { top: rowY(1), bottom: rowY(2) + 20, right: 220 };
    expect(two.crop.y + two.crop.h).toBe(ink.bottom + SNAPSHOT.PADDING);
    expect(two.crop.x + two.crop.w).toBe(ink.right + SNAPSHOT.PADDING);
    // Labels sit above the top ink; the tag sits left of the ink. Both stay inside the crop.
    expect(two.crop.y).toBeLessThan(ink.top - SNAPSHOT.LABEL_PX - SNAPSHOT.PADDING + 1);
    expect(two.width).toBe(Math.round(two.crop.w * 2));
    expect(two.height).toBe(Math.round(two.crop.h * 2));
    expect(plan(state, "p1/r3").height).toBeGreaterThan(two.height);
  });

  it("tags R1, R2 at each row's left and centres each number above its cluster", () => {
    const state = session(pen("a", 1, 100, 0), pen("b", 1, 300, 100), pen("c", 2, 160, 200));
    const result = plan(state, "p1/r2");
    expect(result.tags.map((t) => t.text)).toEqual(["R1", "R2"]);
    expect(result.tags[0]!.box.x + result.tags[0]!.box.w).toBeLessThanOrEqual(100 - SNAPSHOT.TAG_GAP + 0.001);
    expect(result.tags[1]!.box.x + result.tags[1]!.box.w).toBeLessThanOrEqual(160 - SNAPSHOT.TAG_GAP + 0.001);
    expect(result.tags[0]!.y).toBe(rowY(1) + 10);
    expect(result.labels.map((l) => [l.text, l.x])).toEqual([["1", 110], ["2", 310], ["1", 170]]);
    for (const label of result.labels) expect(label.box.y + label.box.h).toBeLessThanOrEqual(rowY(label.rowId === "p1/r1" ? 1 : 2));
  });

  it("nudges a number sideways so neighbouring numbers never overlap", () => {
    // Ten narrow symbols 6 px apart: centred numbers would collide.
    const strokes = Array.from({ length: 10 }, (_, i) => pen(`s${i}`, 1, 100 + i * 10, i * 100, 4));
    const result = plan(session(...strokes), "p1/r1");
    expect(result.labels).toHaveLength(10);
    const boxes = result.labels.map((l) => l.box);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
    // Numbers keep left-to-right order and stay close to their clusters.
    const xs = result.labels.map((l) => l.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const [i, label] of result.labels.entries()) expect(Math.abs(label.x - (102 + i * 10))).toBeLessThan(SNAPSHOT.NUDGE_MAX);
  });

  it("real fraction (ac3 row 1): numbers avoid other clusters' ink; the denominator's goes below it", () => {
    const state = replay("ac3-handwriting");
    const result = plan(state, "demo-worksheet/p1/r2", "demo-worksheet/p1");
    const clusters = listClusters(state, ["demo-worksheet/p1/r1", "demo-worksheet/p1/r2"]);
    for (const label of result.labels) {
      for (const cluster of clusters) {
        if (cluster.id === label.clusterId) continue;
        const [a, b] = [label.box, cluster.bbox];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${label.clusterId} over ${cluster.id}`).toBe(false);
      }
    }
    // Row 1 is ∫ | x | tap | bar | denominator | d | x (P2.5 regression), so cluster 5 is the denominator.
    const denominator = clusters.find((c) => c.id === "demo-worksheet/p1/r1/c5")!;
    const label = result.labels.find((l) => l.clusterId === denominator.id)!;
    expect(label.box.y).toBeGreaterThanOrEqual(denominator.bbox.y + denominator.bbox.h);
    expect(Math.abs(label.x - (denominator.bbox.x + denominator.bbox.w / 2))).toBeLessThan(1);
  });

  it("leaves out erased strokes, eraser strokes, other problems and rows past upTo", () => {
    let state = session(pen("a", 1, 100, 0), pen("b", 1, 400, 100), pen("c", 2, 100, 200));
    state = reduceSessionEvent(state, { type: "erase", at: 300, strokeIds: ["b"], rowId: "p1/r1" });
    state = reduceSessionEvent(state, { type: "stroke_end", at: 410, stroke: { ...pen("q", 1, 600, 400), problemId: "p2" } });
    const result = plan(state, "p1/r1");
    expect(result.strokes.map((s) => s.id)).toEqual(["a"]);
    expect(result.crop.x + result.crop.w).toBe(120 + SNAPSHOT.PADDING);
    expect(result.rows).toEqual([{ rowId: "p1/r1", index: 1, clusterLabels: [1] }]);
  });

  it("lists the stuck row even when it has no ink, and skips blank rows before it", () => {
    const state = session(pen("a", 1, 100, 0), pen("c", 3, 100, 200));
    expect(plan(state, "p1/r3").rows.map((r) => r.index)).toEqual([1, 3]);
    expect(plan(state, "p1/r2").rows.map((r) => r.index)).toEqual([1, 2]);
    expect(plan(state, "p1/r2").tags.map((t) => t.text)).toEqual(["R1"]);
  });

  it("the marked and clean images share one crop", () => {
    const state = session(pen("a", 1, 100, 0));
    expect(plan(state, "p1/r1")).toEqual(plan(state, "p1/r1"));
  });

  it("rejects a row of another problem", () => {
    const state = session(pen("a", 1, 100, 0));
    expect(() => plan(state, "p1/r1", "p2")).toThrow("upToRowId");
  });

  it("scales a large crop so the longer side is at most 1400 px", () => {
    const tall = Array.from({ length: 12 }, (_, i) => pen(`s${i}`, i + 1, 100, i * 100, 600));
    const result = plan(session(...tall), "p1/r12");
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(SNAPSHOT.MAX_SIDE);
    expect(result.scale).toBeLessThan(SNAPSHOT.SCALE);
  });

  it("free layout: tags follow line indexes and rows match the store's clusters", () => {
    const state = replay("ac4-handwriting");
    const rows = state.rows.filter((r) => r.problemId === "demo-worksheet/p1").sort((a, b) => a.index - b.index);
    const last = rows.at(-1)!;
    const result = plan(state, last.id, "demo-worksheet/p1");
    expect(result.rows).toEqual(rows.map((row) => ({ rowId: row.id, index: row.index,
      clusterLabels: (state.clusters[row.id] ?? []).map((c) => c.label) })));
    expect(result.tags.map((t) => t.text)).toEqual(rows.map((r) => `R${r.index}`));
    expect(result.labels).toHaveLength(listClusters(state, rows.map((r) => r.id)).length);
    expect(plan(state, rows[0]!.id, "demo-worksheet/p1").height).toBeLessThan(result.height);
  });
});
