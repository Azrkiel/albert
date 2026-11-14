import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINE, PAGE, type BBox, type Point, type Stroke } from "../../src/lib/contracts";
import { createSessionState, inkedRowIds, parseRecording, reduceSessionEvent, type SessionState } from "../../src/lib/canvas";
import { isDivider } from "../../src/lib/canvas/shapes";

let seq = 0;
function pen(box: BBox, points?: Array<[number, number]>): Stroke {
  const t0 = seq * 100;
  seq++;
  const pts: Point[] = (points ?? [[box.x, box.y], [box.x + box.w, box.y + box.h]]).map(([x, y], i) => ({ x, y, t: t0 + i, p: 0.5 }));
  return { id: `st_${String(seq).padStart(3, "0")}`, problemId: "p1", rowId: null, tool: "pen", pointerType: "pen",
    points: pts, t0, t1: pts.at(-1)!.t, bbox: box };
}
/** A straight vertical divider at x from top to bottom. */
const divider = (x: number, top: number, bottom: number) => pen({ x, y: top, w: 4, h: bottom - top }, [[x, top], [x + 4, bottom]]);

function write(strokes: Stroke[], start: SessionState = createSessionState(["p1"], "ws", undefined, "free")): SessionState {
  return strokes.reduce((state, stroke) => reduceSessionEvent(state, { type: "stroke_end", at: stroke.t1, stroke }), start);
}
const rowOf = (state: SessionState, s: Stroke) => state.strokes.find((x) => x.id === s.id)!.rowId!;
const row = (state: SessionState, s: Stroke) => state.rows.find((r) => r.id === rowOf(state, s))!;

describe("isDivider (P2.5b-AC1)", () => {
  it("a long, straight, near-vertical stroke is a divider", () => {
    expect(isDivider(divider(400, 100, 100 + LINE.DIVIDER_MIN_HEIGHT))).toBe(true);
  });
  it("a short vertical stroke, a wide diagonal and a tall thin integral are not", () => {
    expect(isDivider(divider(400, 100, 100 + LINE.DIVIDER_MIN_HEIGHT - 1))).toBe(false);
    expect(isDivider(pen({ x: 100, y: 100, w: 200, h: 300 }))).toBe(false);
    // ∫ 300 tall, 40 wide (ratio 0.13), with hooks at both ends: path ÷ end-to-end distance ≈ 1.26 > 1.1.
    const integral = pen({ x: 100, y: 100, w: 40, h: 300 }, [[140, 115], [130, 100], [120, 110], [120, 390], [110, 400], [100, 385]]);
    expect(isDivider(integral)).toBe(false);
    // A slanted, slightly wobbly hand line still counts.
    const slanted = pen({ x: 380, y: 100, w: 30, h: 300 }, [[380, 100], [388, 180], [392, 260], [403, 340], [410, 400]]);
    expect(isDivider(slanted)).toBe(true);
  });
});

describe("divider height is relative to the writing (P2.5b-AC1)", () => {
  // Letters 50 tall: a divider must be at least 3 × 50 = 150 (and at least LINE.DIVIDER_MIN_HEIGHT).
  const letters = () => [0, 1, 2, 3, 4].map((i) => pen({ x: 100 + 40 * i, y: 100, w: 25, h: 50 }));

  it("a straight '1' is never a divider; a line several letters tall is", () => {
    const context = letters();
    const one = divider(400, 100, 175);           // 1.5 letters tall
    const short = divider(400, 100, 240);         // 140: above the absolute floor, under 3 letters
    const long = divider(400, 100, 260);          // 160: over 3 letters
    expect(isDivider(one, context)).toBe(false);
    expect(isDivider(short, context)).toBe(false);
    expect(isDivider(long, context)).toBe(true);
    expect(LINE.DIVIDER_MIN_GLYPHS * 50).toBeGreaterThan(140);
  });

  it("only earlier letters set the baseline, so a divider stays a divider when bigger writing follows", () => {
    const context = letters();
    const d = divider(400, 100, 260);
    const later = [0, 1, 2, 3, 4, 5].map((i) => pen({ x: 450 + 40 * i, y: 300, w: 25, h: 90 }));
    expect(isDivider(d, [...context, ...later])).toBe(true);
  });
});

describe("side work beside a divider (P2.5b-AC1)", () => {
  const main1 = () => pen({ x: 100, y: 120, w: 200, h: 30 });
  const main2 = () => pen({ x: 100, y: 220, w: 200, h: 30 });
  const line = () => divider(400, 100, 420);

  it("ink right of a divider at the same height as main lines starts its own lines", () => {
    const [m1, m2, d] = [main1(), main2(), line()];
    const s1 = pen({ x: 450, y: 125, w: 100, h: 25 }), s2 = pen({ x: 450, y: 225, w: 100, h: 25 });
    const state = write([m1, m2, d, s1, s2]);
    expect(new Set([m1, m2, s1, s2].map((s) => rowOf(state, s))).size).toBe(4);
    // Main column first, then the side column, each top to bottom.
    expect([m1, m2, s1, s2].map((s) => row(state, s).index)).toEqual([1, 2, 3, 4]);
    // Rows span their column: main up to the divider, side from the divider.
    expect(row(state, m1).bbox).toMatchObject({ x: PAGE.studentCol.x, w: 402 - PAGE.studentCol.x });
    expect(row(state, s1).bbox).toMatchObject({ x: 402, w: PAGE.studentCol.x + PAGE.studentCol.w - 402 });
  });

  it("main work continued left of the divider joins its main line", () => {
    const [m1, d] = [main1(), line()];
    const more = pen({ x: 310, y: 122, w: 40, h: 26 });
    const state = write([m1, d, more]);
    expect(rowOf(state, more)).toBe(rowOf(state, m1));
  });

  it("below the divider's end the page is one column again", () => {
    const [m1, d] = [main1(), line()];
    const side = pen({ x: 450, y: 125, w: 100, h: 25 });
    const belowLeft = pen({ x: 100, y: 500, w: 100, h: 30 });
    const belowRight = pen({ x: 450, y: 502, w: 100, h: 26 });
    const state = write([m1, d, side, belowLeft, belowRight]);
    expect(rowOf(state, belowRight)).toBe(rowOf(state, belowLeft));
    expect(row(state, belowLeft).bbox.w).toBe(PAGE.studentCol.w);
    expect([m1, belowLeft, side].map((s) => row(state, s).index)).toEqual([1, 2, 3]);
  });

  it("the divider is page structure: its own row, last, unnumbered and never a cluster", () => {
    const [m1, d] = [main1(), line()];
    const state = write([m1, d]);
    const divRow = row(state, d);
    expect(divRow.index).toBe(state.rows.filter((r) => r.problemId === "p1").length);
    expect(inkedRowIds(state.strokes).has(divRow.id)).toBe(false);
    expect(state.clusters[divRow.id]).toEqual([]);
  });

  it("erasing the divider and undoing it keep P2.4's history valid", () => {
    const [m1, d] = [main1(), line()];
    const state = write([m1, d]);
    const erased = reduceSessionEvent(state, { type: "erase", at: 9000, strokeIds: [d.id], rowId: rowOf(state, d) });
    const side = pen({ x: 450, y: 125, w: 100, h: 25 });
    expect(rowOf(write([side], erased), side)).toBe(rowOf(state, m1)); // no divider: same line again
    const undone = reduceSessionEvent(erased, { type: "undo", at: 9100, strokeIds: [d.id], rowId: rowOf(state, d) });
    expect(undone.strokes.find((s) => s.id === d.id)!.erasedAt).toBeUndefined();
  });

  it("the ruled layout ignores dividers for rows but still keeps them out of clusters", () => {
    const d = divider(400, 100, 420);
    const state = write([d], createSessionState(["p1"]));
    expect(state.layout).toBe("ruled");
    expect(state.clusters[rowOf(state, d)]).toEqual([]);
  });
});

describe("real side work (P2.5b-AC3 sample)", () => {
  it("main line, side line and the line below stay separate; the 161 px hand-drawn divider counts", () => {
    const rec = parseRecording(JSON.parse(readFileSync("fixtures/sessions/ac5-side-work.json", "utf8")));
    const erased = new Set(rec.events.flatMap((e) => e.type === "erase" ? e.strokeIds : []));
    const strokes = rec.events.flatMap((e) => e.type === "stroke_end" && !erased.has(e.stroke.id) ? [e.stroke] : [])
      .sort((a, b) => a.t0 - b.t0);
    const state = strokes.reduce((st, stroke) => reduceSessionEvent(st, { type: "stroke_end", at: stroke.t1, stroke: { ...stroke, rowId: null } }),
      createSessionState(rec.problems, rec.worksheetId, undefined, "free"));
    const lines = state.rows.map((r) => [r.index, Math.round(r.bbox.x), state.strokes.filter((x) => x.rowId === r.id).length]);
    // main (left of x 380) | the long stroke below | side work (right) | the divider's own row
    expect(lines).toEqual([[1, 0, 13], [2, 0, 1], [3, 389, 16], [4, 380, 1]]);
  });
});
