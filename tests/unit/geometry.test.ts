import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE, type BBox, type Cluster, type Row } from "../../src/lib/contracts";
import { createSessionState, listClusters, parseRecording, reduceSessionEvent } from "../../src/lib/canvas";
import { arrowFor, circleFor, marginAnchor, targetBox, underlineFor, WRITE } from "../../src/lib/ink";

const row: Row = { id: "p/r2", problemId: "p", index: 2, bbox: { x: 0, y: 224, w: 760, h: 128 } };
const a: Cluster = { id: "p/r2/c1", rowId: row.id, label: 1, strokeIds: ["s1"], bbox: { x: 100, y: 244, w: 20, h: 40 } };
const b: Cluster = { ...a, id: "p/r2/c2", label: 2, bbox: { x: 150, y: 254, w: 50, h: 60 } };
const other: Cluster = { ...a, id: "p/r1/c1", rowId: "p/r1", bbox: { x: 0, y: 0, w: 1000, h: 1000 } };

function corners(box: BBox) {
  return [box.x, box.x + box.w].flatMap((x) => [box.y, box.y + box.h].map((y) => ({ x, y })));
}

describe("targetBox (P4.1-AC4)", () => {
  it("unions only requested row-local targets, independent of order and duplicates", () => {
    expect(targetBox([b.id, a.id, b.id], [other, a, b], row)).toEqual({ x: 100, y: 244, w: 100, h: 70 });
    expect(targetBox([a.id], [b, a], row)).toEqual(a.bbox);
  });
  it.each([[], ["missing"], [other.id], [a.id, "missing"]].map((ids) => [ids]))("falls back to the whole row's ink for %j", (ids) => {
    expect(targetBox(ids, [other, a, b], row)).toEqual({ x: 100, y: 244, w: 100, h: 70 });
  });
  it("uses the actual row box when the row has no clusters", () => {
    const free: Row = { ...row, index: 7, bbox: { x: 400, y: 317, w: 360, h: 43 } };
    const result = targetBox([], [other], free);
    expect(result).toEqual(free.bbox);
    result.x = -1;
    expect(free.bbox.x).toBe(400);
  });
});

describe("annotation geometry (P4.1-AC3)", () => {
  it.each([
    { x: 100, y: 200, w: 20, h: 30 }, { x: 0, y: 0, w: 760, h: 128 },
    { x: -20, y: 5, w: 0, h: 0 }, { x: 0, y: 0, w: 500, h: 1 },
    { x: 1.25, y: 9.75, w: 2.5, h: 400 },
  ])("the actual ellipse contains all target corners: %j", (box) => {
    const ellipse = circleFor(box);
    expect(ellipse.cx).toBe(box.x + box.w / 2);
    expect(ellipse.cy).toBe(box.y + box.h / 2);
    for (const point of corners(box)) {
      expect(((point.x - ellipse.cx) / ellipse.rx) ** 2 + ((point.y - ellipse.cy) / ellipse.ry) ** 2).toBeLessThanOrEqual(1);
    }
    expect(ellipse.rx).toBeGreaterThanOrEqual(box.w / 2 + WRITE.circlePad);
    expect(ellipse.ry).toBeGreaterThanOrEqual(box.h / 2 + WRITE.circlePad);
  });
  it("underlines span the target with circlePad clearance below it", () => {
    expect(underlineFor(a.bbox)).toEqual({ x1: 100, y1: 294, x2: 120, y2: 294 });
  });
  it("anchors to the actual row centre before hint text exists", () => {
    expect(marginAnchor(row)).toEqual({ x: PAGE.albertCol.x + 6, y: 288 });
    expect(marginAnchor({ ...row, index: 9, bbox: { x: 420, y: 391, w: 340, h: 42 } })).toEqual({ x: 796, y: 412 });
  });
  it.each([
    [{ x: 500, y: 250 }, { x: 130, y: 250 }],
    [{ x: 0, y: 250 }, { x: 90, y: 250 }],
    [{ x: 110, y: 0 }, { x: 110, y: 234 }],
    [{ x: 110, y: 500 }, { x: 110, y: 294 }],
    [{ x: 500, y: 0 }, { x: 130, y: 234 }],
    [{ x: 110, y: 250 }, { x: 110, y: 234 }],
    [{ x: 130, y: 250 }, { x: 130, y: 250 }],
  ])("curves from %j to the nearest padded edge %j with finite arrowheads", (from, end) => {
    const result = arrowFor(from, a.bbox);
    const values = result.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);
    expect(result.path).toMatch(/^M .+ Q /);
    expect(values.slice(0, 2)).toEqual([from.x, from.y]);
    expect(values.slice(-2)).toEqual([end.x, end.y]);
    expect(result.head).toHaveLength(2);
    for (const head of result.head) {
      expect(head).toMatch(/^M /);
      expect(head).toContain(`L ${end.x} ${end.y}`);
    }
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    expect(arrowFor(from, a.bbox)).toEqual(result);
  });
});

describe("current canvas shapes", () => {
  it.each(["missing-dx", "ac4-handwriting", "ac5-side-work"])("accepts real rows and clusters from %s without mutation", (name) => {
    const rec = parseRecording(JSON.parse(readFileSync(`fixtures/sessions/${name}.json`, "utf8")));
    const state = rec.events.reduce(reduceSessionEvent, createSessionState(rec.problems, rec.worksheetId, rec.rows, rec.layout));
    const clusters = listClusters(state);
    const before = JSON.stringify({ rows: state.rows, clusters });
    for (const current of state.rows) {
      const targets = clusters.filter((cluster) => cluster.rowId === current.id);
      const box = targetBox([], clusters, current);
      const ellipse = circleFor(box);
      for (const target of targets) for (const point of corners(target.bbox)) {
        expect(((point.x - ellipse.cx) / ellipse.rx) ** 2 + ((point.y - ellipse.cy) / ellipse.ry) ** 2).toBeLessThanOrEqual(1);
      }
      expect(arrowFor(marginAnchor(current), box)).toEqual(arrowFor(marginAnchor(current), box));
    }
    expect(JSON.stringify({ rows: state.rows, clusters })).toBe(before);
  });
});
