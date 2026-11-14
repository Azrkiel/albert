import { describe, expect, it, vi } from "vitest";
import { PAGE, type BBox, type InkSegment, type Row } from "../../src/lib/contracts";
import { layoutHint, type Measure } from "../../src/lib/ink";

const row: Row = { id: "p/r2", problemId: "p", index: 2, bbox: { x: 0, y: 224, w: 760, h: 128 } };
const left = PAGE.albertCol.x + 16;
const top = row.bbox.y + PAGE.rowPaddingTop;
const width = PAGE.albertCol.w - 32;
const text = (value: string): InkSegment => ({ type: "text", text: value });
const math = (latex: string): InkSegment => ({ type: "math", latex });
const measure: Measure = (seg, size) => ({ w: seg.type === "break" ? 0 : (seg.type === "math" ? seg.latex.length : seg.text.length) * 10, h: size });
function layout(segments: InkSegment[], extra: { citation?: string; occupied?: BBox[]; measure?: Measure; row?: Row } = {}) {
  return layoutHint({ row, segments, measure, occupied: [], ...extra });
}
function inside(result: ReturnType<typeof layoutHint>) {
  for (const item of result.items) {
    expect(item.x).toBeGreaterThanOrEqual(PAGE.albertCol.x);
    expect(item.x + item.w).toBeLessThanOrEqual(PAGE.albertCol.x + PAGE.albertCol.w);
    expect(item.x).toBeGreaterThanOrEqual(result.bbox.x);
    expect(item.y).toBeGreaterThanOrEqual(result.bbox.y);
    expect(item.x + item.w).toBeLessThanOrEqual(result.bbox.x + result.bbox.w);
    expect(item.y + item.h).toBeLessThanOrEqual(result.bbox.y + result.bbox.h);
  }
}

describe("layoutHint", () => {
  it("P4.1-AC1: wraps whole words inside the column at 10 px per character", () => {
    const result = layout([text("You replaced x. What does dx become? Check the differential before continuing.")]);
    inside(result);
    expect(new Set(result.items.map((item) => item.line)).size).toBeGreaterThan(1);
    expect(result.items[0]).toMatchObject({ seg: text("You"), x: left, y: top, line: 0, w: 30, h: 26 });
    const long = layout([text(Array(200).fill("word").join(" "))]);
    inside(long);
    expect(long.items).toHaveLength(200);
  });
  it("wraps a whole math segment and resumes text after it", () => {
    const formula = math("dx = 4 cos theta dtheta");
    const result = layout([text("What happens to "), formula, text(" now?")]);
    expect(result.items.find((item) => item.seg.type === "math")).toMatchObject({ seg: formula, x: left, y: top + 36, line: 1 });
    expect(result.items.at(-1)).toMatchObject({ seg: text("now?"), line: 1 });
    expect(result.items.filter((item) => item.seg.type === "math")).toHaveLength(1);
    inside(result);
  });
  it("preserves text/math adjacency and whitespace across segment boundaries", () => {
    const result = layout([text("  dx"), math("="), text("  four"), text(" "), math("dtheta")]);
    expect(result.items.map((item) => item.x)).toEqual([left, left + 20, left + 50, left + 100]);
    expect(result.items.map((item) => item.line)).toEqual([0, 0, 0, 0]);
  });
  it("drops whitespace at wraps and accepts exact-fit items", () => {
    const custom: Measure = (seg, size) => ({ w: seg.type === "math" ? width : 10, h: size });
    const result = layout([math("exact fit"), text(" word")], { measure: custom });
    expect(result.items[0]).toMatchObject({ x: left, w: width, line: 0 });
    expect(result.items[1]).toMatchObject({ x: left, line: 1 });
    inside(result);
  });
  it("honours leading, consecutive and trailing explicit breaks without measuring them", () => {
    const measured = vi.fn(measure);
    const result = layout([{ type: "break" }, text("first"), { type: "break" }, { type: "break" }, text("last"), { type: "break" }], { measure: measured });
    expect(result.items.map((item) => [item.line, item.y])).toEqual([[1, top + 36], [3, top + 108]]);
    expect(result.bbox.h).toBe(180);
    expect(measured.mock.calls.every(([seg]) => seg.type !== "break")).toBe(true);
  });
  it("places the citation on its own final line, measured at citationSize", () => {
    const measured = vi.fn(measure);
    const result = layout([text("What changes?"), math("dx")], { citation: "Lecture 9, Step 2", measure: measured });
    expect(result.items.at(-1)).toMatchObject({ seg: { type: "citation", text: "Lecture 9, Step 2" }, x: left, y: top + 36, line: 1, h: 18 });
    expect(measured).toHaveBeenCalledWith(text("Lecture 9, Step 2"), 18);
    expect(measured).toHaveBeenCalledWith(math("dx"), 26);
    inside(result);
    expect(layout([text("hint"), { type: "break" }], { citation: "source" }).items.at(-1)?.line).toBe(1);
    expect(layout([], { citation: "source" }).items[0]?.line).toBe(0);
  });
  it("reserves measured height for tall math before the next line and citation", () => {
    const tall: Measure = (seg, size) => ({ w: 50, h: seg.type === "math" ? 90 : size });
    const result = layout([math("fraction"), { type: "break" }, text("question")], { measure: tall, citation: "source" });
    expect(result.items.map((item) => item.y)).toEqual([top, top + 90, top + 126]);
    inside(result);
  });
  it("P4.1-AC2: stacks a second same-row hint below the whole first hint", () => {
    const first = layout([text("What does dx become?")], { citation: "Lecture 9" });
    const second = layout([text("Replace the differential too.")], { occupied: [first.bbox] });
    expect(second.bbox.y).toBeGreaterThanOrEqual(first.bbox.y + first.bbox.h);
    expect((second.bbox.y - top) % 36).toBe(0);
    expect(second.items[0]?.y).toBe(second.bbox.y);
    inside(second);
  });
  it("rechecks all occupied boxes after moving and ignores horizontal separation / touching", () => {
    const occupied = [{ x: left, y: top, w: 300, h: 36 }, { x: left, y: top + 36, w: 300, h: 72 }];
    const result = layout([text("hint")], { occupied: [...occupied].reverse() });
    expect(result.bbox.y).toBe(top + 108);
    expect(layout([text("hint")], { occupied }).bbox).toEqual(result.bbox);
    expect(layout([text("hint")], { occupied: [{ x: 0, y: top, w: PAGE.studentCol.w, h: 1000 }] }).bbox.y).toBe(top);
    expect(layout([text("hint")], { occupied: [{ x: left + 40, y: top, w: 100, h: 100 }] }).bbox.y).toBe(top);
  });
  it("uses the actual inferred/side-work row box, with deterministic immutable inputs", () => {
    const free = { ...row, index: 19, bbox: { x: 420, y: 391, w: 340, h: 42 } };
    const segments = [text("Check "), math("dx"), { type: "break" } as InkSegment, text("again?")];
    const occupied = [{ x: left, y: 401, w: 100, h: 37 }];
    const before = JSON.stringify({ free, segments, occupied });
    const first = layout(segments, { row: free, occupied });
    expect(first.bbox.y).toBe(473);
    expect(layout(segments, { row: free, occupied })).toEqual(first);
    expect(JSON.stringify({ free, segments, occupied })).toBe(before);
  });
  it("returns a zero-sized anchored box for no content", () => {
    expect(layout([])).toEqual({ items: [], bbox: { x: left, y: top, w: 0, h: 0 } });
    expect(layout([text("   ")])).toEqual(layout([]));
  });
  it.each([math("m".repeat(38)), text("w".repeat(38))])("explicitly rejects oversized indivisible content %j", (segment) => {
    expect(() => layout([segment])).toThrow(RangeError);
    expect(() => layout([segment])).toThrow(/exceeds.*378/);
  });
  it("explicitly rejects an oversized single-line citation", () => {
    expect(() => layout([text("hint")], { citation: "c".repeat(38) })).toThrow(/citation.*exceeds.*378/);
  });
  it.each([{ w: -1, h: 10 }, { w: 10, h: NaN }, { w: Infinity, h: 10 }])("rejects invalid measurement %j", (size) => {
    expect(() => layout([text("word")], { measure: () => size })).toThrow(RangeError);
  });
});

describe("free layout: lines closer than a note (phase-2 P2.5a/P2.5b downstream notes)", () => {
  it("P4.1-AC2: notes for close lines and same-height side work stack instead of overlapping", () => {
    const lineA: Row = { id: "p/r0", problemId: "p", index: 0, bbox: { x: 0, y: 391, w: 760, h: 42 } };
    const lineB: Row = { ...lineA, id: "p/r1", index: 1, bbox: { x: 0, y: 425, w: 760, h: 42 } };
    const side: Row = { ...lineA, id: "p/r2", index: 2, bbox: { x: 420, y: 391, w: 340, h: 42 } };
    const segments = [text("You replaced x. What does dx become? Check the differential before continuing.")];
    const notes: BBox[] = [];
    for (const line of [lineA, lineB, side]) {
      const note = layout(segments, { row: line, occupied: [...notes] });
      inside(note);
      // Each note is taller than the gap between the two lines, so stacking is what keeps them apart.
      expect(note.bbox.h).toBeGreaterThan(lineB.bbox.y - lineA.bbox.y);
      expect(note.bbox.y).toBeGreaterThanOrEqual(line.bbox.y + PAGE.rowPaddingTop);
      for (const earlier of notes) {
        expect(note.bbox.y >= earlier.y + earlier.h || note.bbox.y + note.bbox.h <= earlier.y).toBe(true);
      }
      notes.push(note.bbox);
    }
    const [a, b, c] = notes;
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.h);
    expect(c!.y).toBeGreaterThanOrEqual(b!.y + b!.h);
  });
});
