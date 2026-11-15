import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlbertMarkSpec, Cluster, Row } from "../../src/lib/contracts";
import { createConductor, type HintContext } from "../../src/lib/ink/conductor";
import { arrowMark, circleMark, crossOutMark, underlineMark } from "../../src/lib/ink/marks";
import { WRITE } from "../../src/lib/ink/constants";
import { prepareMeasure, renderSegment } from "../../src/lib/ink/text";

vi.mock("../../src/lib/ink/marks", () => ({
  hashSeed: () => 1, circleMark: vi.fn(), underlineMark: vi.fn(), crossOutMark: vi.fn(), arrowMark: vi.fn(),
}));
vi.mock("../../src/lib/ink/text", () => ({ prepareMeasure: vi.fn(), renderSegment: vi.fn() }));

// Only the SVG boundary is faked: target selection and queue execution are real.
function group() {
  return { ownerSVGElement: {}, style: {}, setAttribute: vi.fn(), removeAttribute: vi.fn(), remove: vi.fn(), append: vi.fn(), querySelector: () => null,
    querySelectorAll: () => [], getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }) } as unknown as SVGGElement;
}
const row: Row = { id: "p/r1", problemId: "p", index: 1, bbox: { x: 0, y: 96, w: 760, h: 128 } };
const cluster: Cluster = { id: "p/r1/c1", rowId: row.id, label: 1, strokeIds: ["s1"], bbox: { x: 40, y: 110, w: 30, h: 20 } };
const ctx = (): HintContext => ({ hintId: "h1", seedId: "h1", problemId: "p", rowId: row.id, rung: 1 });
const specs: AlbertMarkSpec[] = [
  ...(["circle", "underline", "cross_out"] as const).map((type) => ({ type, rowId: row.id, clusterIds: [cluster.id] })),
  { type: "arrow", toRowId: row.id, toClusterIds: [cluster.id] },
];
beforeEach(() => {
  vi.stubGlobal("document", { createElementNS: group });
  for (const render of [circleMark, underlineMark, crossOutMark]) vi.mocked(render).mockReturnValue(group());
  vi.mocked(arrowMark).mockReturnValue({ group: group(), shaft: "" });
  vi.mocked(prepareMeasure).mockResolvedValue(() => ({ w: 20, h: 20 }));
  vi.mocked(renderSegment).mockImplementation(async () => ({ node: group(), w: 20, h: 20, baseline: 18, glyphs: 1 }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("conductor current ink targets", () => {
  it("uses dynamic PDF mode to keep the compact circle and omit cross-page arrows", async () => {
    let pdf = false;
    const conductor = createConductor({ geometry: () => ({ rows: [{ ...row, page: 1 }], clusters: [cluster] }),
      reducedMotion: () => true, now: () => 0, pageMode: () => pdf, pageHeight: () => 900 });
    conductor.attach("p", group(), 1);
    const context = ctx();
    conductor.handle(context, { type: "mark", mark: specs[0]! });
    conductor.handle(context, { type: "mark", mark: specs[3]! });
    pdf = true;
    await conductor.idle();
    expect(conductor.marksOf(context.hintId).map((mark) => mark.spec.type)).toEqual(["circle"]);
    expect(circleMark).toHaveBeenCalledWith(expect.anything(), cluster.bbox, 1);
    expect(arrowMark).not.toHaveBeenCalled();
  });
  it("labels PDF notes and shares occupied space only with notes on the same page", async () => {
    const rows: Row[] = [{ ...row, page: 1 }, { ...row, id: "q/r1", problemId: "q", page: 1 }, { ...row, id: "p/r2", index: 2, page: 2 }];
    const conductor = createConductor({ geometry: () => ({ rows, clusters: [] }), reducedMotion: () => true, now: () => 0,
      pageMode: () => true, pageHeight: () => 900, noteLabel: (id) => `Problem ${id}` });
    for (const target of rows) conductor.attach(target.problemId, group(), target.page);
    const notes = [];
    for (const [index, target] of rows.entries()) {
      const context = { ...ctx(), hintId: `h${index}`, problemId: target.problemId, rowId: target.id };
      conductor.handle(context, { type: "hint", kind: "question", segments: [{ type: "text", text: "What changes?" }] });
      await conductor.idle();
      notes.push(conductor.marksOf(context.hintId).find((mark) => mark.spec.type === "writing")!);
    }
    expect(notes[0]!.bbox.y).toBeGreaterThan(900);
    expect(notes[1]!.bbox.y).toBeGreaterThanOrEqual(notes[0]!.bbox.y + notes[0]!.bbox.h);
    expect(notes[2]!.bbox.y).toBe(notes[0]!.bbox.y);
    expect(vi.mocked(renderSegment).mock.calls.flatMap(([seg]) => seg.type === "text" ? [seg.text] : [])).toContain("Problem");
    // Store the reply once; replay adds the current label rather than duplicating it.
    expect(notes[0]!.spec).toMatchObject({ segments: [{ type: "text", text: "What changes?" }] });
  });
  it.each([undefined, 900])("places the narrow waiting dot below the host's page or current rows: %j", (pageBottom) => {
    const layer = group();
    const conductor = createConductor({ geometry: () => ({ rows: [row], clusters: [cluster] }), reducedMotion: () => true, now: () => 0,
      narrow: () => true, ...(pageBottom === undefined ? {} : { bandTop: () => pageBottom }) });
    conductor.attach("p", layer);
    conductor.handle(ctx(), { type: "started", hintId: "h1", at: 0 });
    const dot = vi.mocked(layer.append).mock.calls[0]![0] as SVGElement;
    expect(dot.setAttribute).toHaveBeenCalledWith("cy", String((pageBottom ?? row.bbox.y + row.bbox.h + 8) + WRITE.lineHeight / 2));
  });
  it.each(specs)("skips $type on an empty or erased row", async (spec) => {
    const geometry = { rows: [row], clusters: [cluster] };
    const conductor = createConductor({ geometry: () => geometry, reducedMotion: () => true, now: () => 0 });
    conductor.attach("p", group());
    const context = ctx();
    conductor.handle(context, { type: "mark", mark: spec });
    geometry.clusters = []; // Erased while the response's draw step was queued.
    await conductor.idle();
    expect(conductor.marksOf(context.hintId)).toEqual([]);
  });
  it("skips ink from another problem even when the row id resolves", async () => {
    const conductor = createConductor({ geometry: () => ({ rows: [{ ...row, problemId: "other" }], clusters: [cluster] }), reducedMotion: () => true, now: () => 0 });
    conductor.attach("p", group());
    const context = ctx();
    conductor.handle(context, { type: "mark", mark: specs[0]! });
    await conductor.idle();
    expect(conductor.marksOf(context.hintId)).toEqual([]);
  });
  it("still draws marks around current row ink", async () => {
    const conductor = createConductor({ geometry: () => ({ rows: [row], clusters: [cluster] }), reducedMotion: () => true, now: () => 0 });
    conductor.attach("p", group());
    const context = ctx();
    conductor.handle(context, { type: "mark", mark: specs[0]! });
    await conductor.idle();
    expect(conductor.marksOf(context.hintId)).toHaveLength(1);
    expect(circleMark).toHaveBeenCalledWith(expect.anything(), cluster.bbox, 1);
  });
});
