import { describe, expect, it } from "vitest";
import { PAGE, StrokeSchema, type Stroke } from "../../src/lib/contracts";
import { assignRow, createRows, ensureRows } from "../../src/lib/canvas/rows";
import { addCompletedStroke, createSessionState } from "../../src/lib/canvas/store";

const rows = createRows("p1");
const y = (index: number) => PAGE.statementMinHeight + (index - 1) * PAGE.rowHeight + 20;

function stroke(ys: number[], extra: Partial<Stroke> = {}): Stroke {
  return {
    id: "st_1", problemId: "p1", rowId: null, tool: "pen", pointerType: "mouse",
    points: ys.map((y, t) => ({ x: 100, y, t, p: 0.5 })),
    t0: 0, t1: Math.max(0, ys.length - 1),
    bbox: { x: 100, y: Math.min(...ys), w: 0, h: Math.max(...ys) - Math.min(...ys) },
    ...extra,
  };
}

describe("assignRow (P2.2-AC1)", () => {
  it("starts with four contract-sized student bands and stable problem-specific ids", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ id: "p1/r1", problemId: "p1", index: 1,
      bbox: { x: PAGE.studentCol.x, y: PAGE.statementMinHeight, w: PAGE.studentCol.w, h: PAGE.rowHeight } });
    expect(rows[3]!.bbox.y).toBe(PAGE.statementMinHeight + 3 * PAGE.rowHeight);
  });
  it("assigns a stroke fully inside one row", () => {
    expect(assignRow(stroke([y(2), y(2) + 10]), rows)).toBe("p1/r2");
  });
  it("uses a 70/30 point majority even when the first point is in the minority", () => {
    expect(assignRow(stroke([...Array<number>(3).fill(y(1)), ...Array<number>(7).fill(y(2))]), rows)).toBe("p1/r2");
  });
  it.each([[1, 2], [2, 1]])("breaks an exact tie using the first point in row %s", (first, second) => {
    expect(assignRow(stroke([y(first), y(second), y(second), y(first)]), rows)).toBe(`p1/r${first}`);
  });
  it("uses the first point's row when two other rows tie for the largest share", () => {
    expect(assignRow(stroke([y(3), y(2), y(2), y(1), y(1)]), rows)).toBe("p1/r3");
  });
  it("assigns a tall three-row integral by points rather than its bounding box", () => {
    expect(assignRow(stroke([y(1), y(2), y(2) + 5, y(2) + 10, y(3)]), rows)).toBe("p1/r2");
  });
  it("puts a point on a shared boundary in the lower row", () => {
    expect(assignRow(stroke([PAGE.statementMinHeight + PAGE.rowHeight]), rows)).toBe("p1/r2");
  });
  it("never assigns another problem's overlapping local row bands", () => {
    expect(assignRow(stroke([y(2)]), [...createRows("p2"), ...rows])).toBe("p1/r2");
  });
  it("keeps an outside-capture tail from outweighing points inside the rows", () => {
    expect(assignRow(stroke([y(2), y(2), -100, -200, -300]), rows)).toBe("p1/r2");
  });
  it("counts points inside the full student band, excluding clipped margin points", () => {
    const ink = stroke([y(1), y(1), y(2), y(2), y(2)]);
    ink.points.slice(2).forEach((point) => { point.x = PAGE.albertCol.x + 10; });
    expect(assignRow(ink, rows)).toBe("p1/r1");
  });
  it("uses the nearest band when all points fall outside the ruled area", () => {
    expect(assignRow(stroke([-100, -200]), rows)).toBe("p1/r1");
    expect(assignRow(stroke([1000]), rows)).toBe("p1/r4");
  });
  it("rejects empty strokes and missing problem rows", () => {
    expect(() => assignRow(stroke([]), rows)).toThrow();
    expect(() => assignRow(stroke([y(1)]), createRows("p2"))).toThrow();
  });
});

describe("ensureRows (P2.2-AC2)", () => {
  it("keeps four rows until ink reaches the last, then appends exactly one", () => {
    expect(ensureRows(rows, [])).toEqual(rows);
    expect(ensureRows(rows, [stroke([y(3)], { rowId: "p1/r3" })])).toEqual(rows);
    const ink = stroke([y(4)], { rowId: "p1/r4" });
    const grown = ensureRows(rows, [ink]);
    expect(grown).toHaveLength(5);
    expect(grown.slice(0, 4)).toEqual(rows);
    expect(grown[4]).toEqual({ id: "p1/r5", problemId: "p1", index: 5,
      bbox: { x: 0, y: PAGE.statementMinHeight + 4 * PAGE.rowHeight, w: PAGE.studentCol.w, h: PAGE.rowHeight } });
    expect(ensureRows(grown, [ink])).toEqual(grown);
    expect(ensureRows(grown, [ink, stroke([y(5)], { rowId: "p1/r5" })])).toHaveLength(6);
    expect(rows).toHaveLength(4);
  });
  it("grows when a tall stroke reaches the last row but belongs to the previous row", () => {
    expect(ensureRows(rows, [stroke([y(3), y(3), y(4)], { rowId: "p1/r3" })])).toHaveLength(5);
  });
  it("ignores erased ink, eraser strokes, and another problem's ink", () => {
    for (const extra of [{ erasedAt: 10 }, { tool: "eraser" as const }, { problemId: "p2" }]) {
      expect(ensureRows(rows, [stroke([y(4)], { rowId: "p1/r4", ...extra })])).toEqual(rows);
    }
    expect(ensureRows([], [])).toEqual([]);
  });
  it("grows only the problem with ink in its last row", () => {
    const grown = ensureRows([...rows, ...createRows("p2")], [stroke([y(4)], { rowId: "p1/r4" })]);
    expect(grown.filter((row) => row.problemId === "p1")).toHaveLength(5);
    expect(grown.filter((row) => row.problemId === "p2")).toEqual(createRows("p2"));
  });
  it("does not grow for points entirely clipped outside the student column", () => {
    const ink = stroke([y(4)], { rowId: "p1/r4" });
    ink.points[0]!.x = PAGE.albertCol.x;
    expect(ensureRows(rows, [ink])).toEqual(rows);
  });
});

describe("completed strokes (P2.2-AC3)", () => {
  it("associates two blocks' strokes with their own problem and row without mutating capture input", () => {
    const initial = createSessionState(["p1", "p2"]);
    const captured = stroke([y(4)]);
    const one = addCompletedStroke(initial, "p1", captured);
    const two = addCompletedStroke(one, "p2", stroke([y(2)], { id: "st_2" }));
    expect(two.strokes.map(({ problemId, rowId }) => ({ problemId, rowId }))).toEqual([
      { problemId: "p1", rowId: "p1/r4" }, { problemId: "p2", rowId: "p2/r2" },
    ]);
    two.strokes.forEach((completed) => expect(StrokeSchema.safeParse(completed).success).toBe(true));
    expect(two.rows.filter((row) => row.problemId === "p1")).toHaveLength(5);
    expect(two.rows.filter((row) => row.problemId === "p2")).toHaveLength(4);
    expect(captured.rowId).toBeNull();
    expect(initial.strokes).toEqual([]);
    expect(initial.rows).toHaveLength(8);
  });
  it("rejects a completion for an unknown block", () => {
    expect(() => addCompletedStroke(createSessionState(["p1"]), "missing", stroke([y(1)]))).toThrow();
  });
});
