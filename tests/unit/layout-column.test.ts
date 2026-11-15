import { describe, expect, it } from "vitest";
import { PAGE, type Row } from "../../src/lib/contracts";
import { layoutHint } from "../../src/lib/ink/layout";

const row: Row = { id: "p/r1", problemId: "p", index: 1, bbox: { x: 0, y: 400, w: 1200, h: 36 } };
const measure = (seg: { type: string; text?: string }) => ({ w: (seg.text ?? "").length * 10, h: 30 });

describe("layoutHint column", () => {
  const segments = [{ type: "text", text: "word ".repeat(30).trim() }] as const;
  it("defaults to Albert's column", () => {
    const { items } = layoutHint({ row, segments: [...segments], measure, occupied: [] });
    for (const item of items) { expect(item.x).toBeGreaterThanOrEqual(PAGE.albertCol.x); expect(item.x + item.w).toBeLessThanOrEqual(PAGE.albertCol.x + PAGE.albertCol.w); }
  });
  it("wraps inside a full-width band when given one, using fewer lines", () => {
    const side = layoutHint({ row, segments: [...segments], measure, occupied: [] });
    const band = layoutHint({ row, segments: [...segments], measure, occupied: [], column: { x: 0, w: PAGE.width } });
    expect(Math.min(...band.items.map((i) => i.x))).toBe(16);
    for (const item of band.items) expect(item.x + item.w).toBeLessThanOrEqual(PAGE.width - 16);
    expect(band.items.at(-1)!.line).toBeLessThan(side.items.at(-1)!.line);
  });
});
