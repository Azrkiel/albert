import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ClusterSchema, STUCK, type BBox, type Stroke } from "../../src/lib/contracts";
import { clusterRow, parseRecording } from "../../src/lib/canvas";

const ROW = "p1/r1";
let seq = 0;

/** A synthetic stroke whose only meaningful geometry is its hand-built bbox. */
function stroke(bbox: Partial<BBox> & { x: number; w: number }, extra: Partial<Stroke> = {}): Stroke {
  const box = { y: 110, h: 30, ...bbox };
  const t0 = extra.t0 ?? seq * 100;
  seq++;
  return {
    id: `st_${String(seq).padStart(3, "0")}`, problemId: "p1", rowId: ROW, tool: "pen", pointerType: "pen",
    points: [{ x: box.x, y: box.y, t: t0, p: 0.5 }, { x: box.x + box.w, y: box.y + box.h, t: t0 + 50, p: 0.5 }],
    t0, t1: t0 + 50, bbox: box, ...extra,
  };
}

/** Symbols of width 20 laid left to right with the given gaps between them. */
function symbols(gaps: number[], width = 20): Stroke[] {
  let x = 100;
  return [0, ...gaps].map((gap) => {
    x += gap;
    const s = stroke({ x, w: width });
    x += width;
    return s;
  });
}

describe("clusterRow (P2.5-AC1)", () => {
  it("AC1a: three symbols with gaps of 60 px give three clusters", () => {
    const clusters = clusterRow(symbols([60, 60]), ROW);
    expect(clusters).toHaveLength(3);
    expect(clusters.map((c) => c.strokeIds.length)).toEqual([1, 1, 1]);
  });

  it("AC1b: a fraction gives numerator, bar, denominator as three adjacent clusters in that order", () => {
    const bar = stroke({ x: 100, w: 80, y: 140, h: 3 });
    const numerator = stroke({ x: 125, w: 30, y: 105, h: 28 });
    const denominator = stroke({ x: 120, w: 40, y: 150, h: 28 });
    const clusters = clusterRow([denominator, bar, numerator], ROW);
    expect(clusters.map((c) => c.strokeIds)).toEqual([[numerator.id], [bar.id], [denominator.id]]);
    expect(clusters.map((c) => c.label)).toEqual([1, 2, 3]);
  });

  it("AC1c: an equals sign (two short parallel strokes, same x-range) gives one cluster", () => {
    const clusters = clusterRow([stroke({ x: 200, w: 24, y: 125, h: 2 }), stroke({ x: 201, w: 23, y: 137, h: 2 })], ROW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.strokeIds).toHaveLength(2);
  });

  it("AC1d: the letter i (stem plus a dot above, overlapping in x) gives one cluster", () => {
    const stem = stroke({ x: 300, w: 4, y: 120, h: 25 });
    const dot = stroke({ x: 301, w: 3, y: 108, h: 3 });
    expect(clusterRow([dot, stem], ROW)).toHaveLength(1);
  });

  it("AC1e: two symbols closer than CLUSTER_GAP give one cluster", () => {
    expect(clusterRow(symbols([STUCK.CLUSTER_GAP / 2]), ROW)).toHaveLength(1);
    expect(clusterRow(symbols([0]), ROW)).toHaveLength(1);
  });

  it("AC1f: two symbols 40 px apart give two clusters", () => {
    expect(clusterRow(symbols([40]), ROW)).toHaveLength(2);
  });
});

describe("clusterRow edges", () => {
  it("a gap of exactly CLUSTER_GAP joins and CLUSTER_GAP + 1 splits", () => {
    expect(clusterRow(symbols([STUCK.CLUSTER_GAP]), ROW)).toHaveLength(1);
    expect(clusterRow(symbols([STUCK.CLUSTER_GAP + 1]), ROW)).toHaveLength(2);
  });

  it("ignores erased strokes and eraser-tool strokes", () => {
    const [a, b, c] = symbols([60, 60]);
    const clusters = clusterRow([a!, { ...b!, erasedAt: 5000 }, { ...c!, tool: "eraser" }], ROW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.strokeIds).toEqual([a!.id]);
  });

  it("ignores strokes from another row", () => {
    const [a, b] = symbols([60]);
    const clusters = clusterRow([a!, { ...b!, rowId: "p1/r2" }], ROW);
    expect(clusters.map((c) => c.strokeIds)).toEqual([[a!.id]]);
  });

  it("joins a later small stroke to a wide early stroke by the running max right edge", () => {
    const integral = stroke({ x: 100, w: 120, y: 100, h: 60 }); // right edge 220
    const lowerLimit = stroke({ x: 105, w: 10 }); // right edge 115, sorted second
    const body = stroke({ x: 220 + STUCK.CLUSTER_GAP, w: 20 }); // within the gap of the integral, far past the limit
    const clusters = clusterRow([body, lowerLimit, integral], ROW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.strokeIds).toEqual([integral.id, lowerLimit.id, body.id]);
  });

  it("returns [] for an empty row", () => {
    expect(clusterRow([], ROW)).toEqual([]);
    expect(clusterRow(symbols([60]).map((s) => ({ ...s, rowId: "p1/r9" })), ROW)).toEqual([]);
  });

  it("every returned cluster parses with the contracts Cluster schema", () => {
    const clusters = clusterRow(symbols([60, 1, 40, STUCK.CLUSTER_GAP, STUCK.CLUSTER_GAP + 1]), ROW);
    expect(clusters.length).toBeGreaterThan(1);
    for (const cluster of clusters) expect(ClusterSchema.parse(cluster)).toEqual(cluster);
  });
});

describe("clusterRow labels (P2.5-AC2)", () => {
  it("AC2a: shuffled input gives the same labels, ids and boxes every time", () => {
    // Includes equal bbox.x (tie-broken by t0) and equal bbox.x and t0 (tie-broken by id).
    const base = [...symbols([60, STUCK.CLUSTER_GAP - 1, 40]), stroke({ x: 100, w: 20 }, { t0: 1 }), stroke({ x: 100, w: 20 }, { t0: 1 })];
    const expected = clusterRow(base, ROW);
    expect(expected.map((c) => c.label)).toEqual([1, 2, 3]);
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let run = 0; run < 25; run++) {
      const shuffled = [...base];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(clusterRow(shuffled, ROW)).toEqual(expected);
    }
  });

  it("AC2b: two rows cluster separately and each row's labels restart at 1", () => {
    const row1 = symbols([60, 60]);
    const row2 = symbols([60]).map((s) => ({ ...s, rowId: "p1/r2", id: `${s.id}_r2` }));
    const all = [...row2, ...row1];
    expect(clusterRow(all, ROW).map((c) => [c.label, c.id, c.rowId]))
      .toEqual([[1, "p1/r1/c1", ROW], [2, "p1/r1/c2", ROW], [3, "p1/r1/c3", ROW]]);
    expect(clusterRow(all, "p1/r2").map((c) => [c.label, c.id, c.rowId]))
      .toEqual([[1, "p1/r2/c1", "p1/r2"], [2, "p1/r2/c2", "p1/r2"]]);
  });
});

describe("clusterRow fractions", () => {
  // A bar 100..220 at y 140..143 (centre 141.5); numerator ink above it, denominator ink below.
  const fraction = (extra: Stroke[] = []) => {
    const bar = stroke({ x: 100, w: 120, y: 140, h: 3 });
    const num = stroke({ x: 150, w: 20, y: 105, h: 28 });
    const denA = stroke({ x: 110, w: 20, y: 150, h: 28 });
    const denB = stroke({ x: 180, w: 20, y: 150, h: 28 }); // 50 px from denA: its own cluster
    return { bar, num, denA, denB, all: [denB, ...extra, bar, denA, num] };
  };

  it("keeps a multi-symbol denominator as a run of adjacent clusters right after the bar", () => {
    const { bar, num, denA, denB, all } = fraction();
    expect(clusterRow(all, ROW).map((c) => c.strokeIds)).toEqual([[num.id], [bar.id], [denA.id], [denB.id]]);
  });

  it("places the fraction among the row's other symbols by its left edge", () => {
    const before = stroke({ x: 40, w: 30, y: 100, h: 60 }); // an integral sign
    const after = stroke({ x: 260, w: 20 });
    const { bar, num, denA, denB, all } = fraction([after, before]);
    expect(clusterRow(all, ROW).map((c) => c.strokeIds))
      .toEqual([[before.id], [num.id], [bar.id], [denA.id], [denB.id], [after.id]]);
  });

  it("absorbs an exponent just past the bar's end into the denominator", () => {
    const { bar, num, denA, denB, all } = fraction();
    const exponent = stroke({ x: 200 + STUCK.CLUSTER_GAP + 18, w: 8, y: 146, h: 10 }); // past the bar, wholly below its centre
    const clusters = clusterRow([...all, exponent], ROW);
    expect(clusters.map((c) => c.strokeIds)).toEqual([[num.id], [bar.id], [denA.id], [denB.id], [exponent.id]]);
    expect(clusterRow([...all, { ...exponent, bbox: { ...exponent.bbox, x: 200 + STUCK.CLUSTER_GAP - 1 } }], ROW)
      .map((c) => c.strokeIds)).toEqual([[num.id], [bar.id], [denA.id], [denB.id, exponent.id]]);
  });

  it("does not absorb a symbol after the fraction that straddles the bar's centre line", () => {
    const { bar, num, denA, denB, all } = fraction();
    const d = stroke({ x: 222, w: 20, y: 120, h: 40 });
    expect(clusterRow([...all, d], ROW).map((c) => c.strokeIds)).toEqual([[num.id], [bar.id], [denA.id], [denB.id], [d.id]]);
  });

  it("keeps a retraced bar together", () => {
    const { bar, num, denA, denB, all } = fraction();
    const retrace = stroke({ x: 104, w: 110, y: 139, h: 4 });
    expect(clusterRow([...all, retrace], ROW).map((c) => c.strokeIds))
      .toEqual([[num.id], [bar.id, retrace.id], [denA.id], [denB.id]]);
  });

  it("splits a nested fraction in the numerator into its own numerator, bar and denominator", () => {
    const bar = stroke({ x: 100, w: 120, y: 160, h: 3 });
    const den = stroke({ x: 150, w: 20, y: 170, h: 10 });
    const innerBar = stroke({ x: 140, w: 40, y: 130, h: 2 });
    const innerNum = stroke({ x: 150, w: 15, y: 110, h: 15 });
    const innerDen = stroke({ x: 150, w: 15, y: 136, h: 15 });
    expect(clusterRow([den, innerDen, bar, innerNum, innerBar], ROW).map((c) => c.strokeIds))
      .toEqual([[innerNum.id], [innerBar.id], [innerDen.id], [bar.id], [den.id]]);
  });

  it("treats a flat stroke with ink on only one side (overline, minus) by the gap rule", () => {
    const overline = stroke({ x: 100, w: 40, y: 105, h: 2 });
    const letter = stroke({ x: 105, w: 25, y: 115, h: 25 });
    expect(clusterRow([letter, overline], ROW)).toHaveLength(1);
    const minus = stroke({ x: 150, w: 14, y: 125, h: 3 }); // between symbols at 100..120 and 180..200
    expect(clusterRow([minus, ...symbols([60])], ROW)).toHaveLength(3);
  });

  it("is order independent with fractions present", () => {
    const { all } = fraction([stroke({ x: 40, w: 30, y: 100, h: 60 }), stroke({ x: 260, w: 20 })]);
    const expected = clusterRow(all, ROW);
    expect(clusterRow([...all].reverse(), ROW)).toEqual(expected);
    expect(clusterRow([all[3]!, ...all.slice(4), ...all.slice(0, 3)], ROW)).toEqual(expected);
  });
});

describe("clusterRow on real handwriting (P2.5-AC3 sample, CLUSTER_GAP 4)", () => {
  const rec = parseRecording(JSON.parse(readFileSync("fixtures/sessions/ac3-handwriting.json", "utf8")));
  const strokes = rec.events.flatMap((event) => event.type === "stroke_end" ? [event.stroke] : []);
  const widths = (rowId: string) => clusterRow(strokes, rowId).map((c) => [Math.round(c.bbox.x), Math.round(c.bbox.x + c.bbox.w)]);

  it("splits ∫ x/(x²√(16−x²)) dx into ∫ | x | bar | whole denominator | d | x", () => {
    // [224, 224] is a stray tap in the statement area that row assignment put in row 1's numerator.
    expect(widths("demo-worksheet/p1/r1")).toEqual([[84, 122], [185, 206], [224, 224], [139, 259], [137, 281], [291, 310], [314, 336]]);
  });

  it("splits x = 4 sin θ into x | = | 4 | s | i | n | θ", () => {
    expect(widths("demo-worksheet/p1/r2")).toEqual([[120, 162], [177, 209], [215, 252], [261, 294], [300, 303], [308, 333], [345, 374]]);
  });
});
