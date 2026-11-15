import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  exportAnnotatedPdf, normalizeRotation, pageTransform, roughMarkPaths, strokeOutlinePath, visibleBox,
  type ExportStroke,
} from "../../src/lib/ink/pdf-export";
import { bounds, makePdf, pageContent, pathPoints } from "./pdf-export-fixtures";

const fontBytes = new Uint8Array(readFileSync("public/fonts/Kalam-Regular.ttf"));
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const line = (x1: number, y1: number, x2: number, y2: number): ExportStroke => ({
  points: Array.from({ length: 11 }, (_, i) => ({ x: x1 + (x2 - x1) * i / 10, y: y1 + (y2 - y1) * i / 10, p: 0.5 })),
});

describe("pageTransform", () => {
  it("plain page: top-left is the top-left, y flips", () => {
    const t = pageTransform({ mediaBox: [0, 0, 600, 800] });
    expect(t.width).toBe(1200);
    expect(t.height).toBe(1600);
    near(t.scale, 0.5);
    expect(t.toPdf(0, 0)).toEqual({ x: 0, y: 800 });
    expect(t.toPdf(1200, 1600)).toEqual({ x: 600, y: 0 });
    expect(t.toPdf(100, 200)).toEqual({ x: 50, y: 700 });
  });
  it("offset MediaBox and CropBox: uses the CropBox origin", () => {
    const t = pageTransform({ mediaBox: [0, 0, 612, 792], cropBox: [100, 50, 400, 450] });
    // visible 300 x 400 => logical 1200 x 1600, scale 0.25
    expect(t.height).toBe(1600);
    near(t.scale, 0.25);
    expect(t.toPdf(0, 0)).toEqual({ x: 100, y: 450 });
    expect(t.toPdf(1200, 1600)).toEqual({ x: 400, y: 50 });
    const m = pageTransform({ mediaBox: [-50, -50, 550, 750] });
    expect(m.toPdf(0, 0)).toEqual({ x: -50, y: 750 });
  });
  it("clips the CropBox to the MediaBox and ignores a disjoint one", () => {
    expect(visibleBox({ mediaBox: [0, 0, 100, 100], cropBox: [50, 50, 300, 300] })).toEqual([50, 50, 100, 100]);
    expect(visibleBox({ mediaBox: [0, 0, 100, 100], cropBox: [200, 200, 300, 300] })).toEqual([0, 0, 100, 100]);
  });
  it("rotate 90: logical width runs along the user y axis", () => {
    const t = pageTransform({ mediaBox: [0, 0, 600, 800], rotate: 90 });
    // displayed 800 x 600 => logical 1200 x 900
    expect(t.height).toBe(900);
    near(t.scale, 800 / 1200);
    expect(t.toPdf(0, 0)).toEqual({ x: 0, y: 0 });              // display top-left = user bottom-left
    const tr = t.toPdf(1200, 0);                                  // display top-right = user top-left
    near(tr.x, 0); near(tr.y, 800);
    const bl = t.toPdf(0, 900);                                   // display bottom-left = user bottom-right
    near(bl.x, 600); near(bl.y, 0);
  });
  it("rotate 270 and 180", () => {
    const t270 = pageTransform({ mediaBox: [0, 0, 600, 800], rotate: 270 });
    const a = t270.toPdf(0, 0);                                   // display top-left = user top-right
    near(a.x, 600); near(a.y, 800);
    const b = t270.toPdf(1200, 0);                                // display top-right = user bottom-right
    near(b.x, 600); near(b.y, 0);
    const t180 = pageTransform({ mediaBox: [0, 0, 600, 800], rotate: 180 });
    const c = t180.toPdf(0, 0);                                   // display top-left = user bottom-right
    near(c.x, 600); near(c.y, 0);
    const d = t180.toPdf(1200, 1600);
    near(d.x, 0); near(d.y, 800);
  });
  it("rotated and cropped together", () => {
    const t = pageTransform({ mediaBox: [0, 0, 612, 792], cropBox: [100, 50, 400, 450], rotate: 90 });
    // visible 300 x 400, displayed 400 x 300
    expect(t.height).toBe(900);
    expect(t.toPdf(0, 0)).toEqual({ x: 100, y: 50 });
    const far = t.toPdf(1200, 900);
    near(far.x, 400); near(far.y, 450);
  });
  it("normalizes odd rotations", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(undefined)).toBe(0);
  });
});

describe("exportAnnotatedPdf", () => {
  it("keeps pages, sizes and boxes; only inked pages grow; strokes land at the expected coordinates", async () => {
    const original = await makePdf([{ size: [600, 800] }, { size: [500, 700] }, { size: [400, 300] }]);
    const out = await exportAnnotatedPdf({
      pdf: original,
      pages: [{ page: 1, strokes: [line(200, 400, 600, 400)] }, { page: 2, strokes: [line(100, 100, 300, 100)] }],
    });
    const before = await PDFDocument.load(original), after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(after.getPage(i).getSize()).toEqual(before.getPage(i).getSize());
      expect(after.getPage(i).getMediaBox()).toEqual(before.getPage(i).getMediaBox());
    }
    const len = (d: PDFDocument, i: number) => pageContent(d, i).length;
    expect(len(after, 0)).toBeGreaterThan(len(before, 0));
    expect(len(after, 1)).toBeGreaterThan(len(before, 1));
    expect(len(after, 2)).toBe(len(before, 2));
    // Page 1: 600 x 800 pt, scale 0.5. Stroke y = 400 logical -> 800 - 200 = 600; x 200..600 -> 100..300 (pen width ~ 2 px).
    const b = bounds(pathPoints(pageContent(after, 0)).filter((p) => p.y > 500));
    expect(b.minX).toBeGreaterThan(98); expect(b.minX).toBeLessThan(100);
    expect(b.maxX).toBeGreaterThan(300); expect(b.maxX).toBeLessThan(302);
    expect(b.minY).toBeGreaterThan(598); expect(b.maxY).toBeLessThan(602);
    // Page 2: 500 x 700 pt, scale 500/1200; y 100 logical -> 700 - 41.67.
    const b2 = bounds(pathPoints(pageContent(after, 1)).filter((p) => p.y > 600));
    near(b2.minY, 700 - 100 * 500 / 1200, 2);
    near((b2.minX + b2.maxX) / 2, 200 * 500 / 1200, 2);
  });

  // Expected points are derived by hand from the page geometry, not from pageTransform. The stroke runs logical
  // (300, 200) -> (500, 200); its midpoint (400, 200) must land at (x, y) in PDF user space.
  // Crop [100, 50, 400, 450]: visible 300 x 400 pt. /Rotate is clockwise as displayed.
  const crop: [number, number, number, number] = [100, 50, 400, 450];
  it.each([
    // visible 300 wide, scale 0.25: x = 100 + 400/4, y = 450 - 200/4
    ["cropped", { size: [612, 792] as [number, number], cropBox: crop }, 200, 400],
    // displayed 800 x 600, scale 2/3; display top-left = user (0, 0), right = +y, down = +x
    ["rotated 90", { size: [600, 800] as [number, number], rotate: 90 }, 200 * 2 / 3, 400 * 2 / 3],
    // scale 0.5; display top-left = user (600, 0), right = -x, down = +y
    ["rotated 180", { size: [600, 800] as [number, number], rotate: 180 }, 600 - 200, 100],
    // scale 2/3; display top-left = user (600, 800), right = -y, down = -x
    ["rotated 270", { size: [600, 800] as [number, number], rotate: 270 }, 600 - 200 * 2 / 3, 800 - 400 * 2 / 3],
    // displayed 400 x 300, scale 1/3; display top-left = crop (100, 50)
    ["cropped + rotated 90", { size: [612, 792] as [number, number], cropBox: crop, rotate: 90 }, 100 + 200 / 3, 50 + 400 / 3],
    // scale 1/3; display top-left = crop (400, 450)
    ["cropped + rotated 270", { size: [612, 792] as [number, number], cropBox: crop, rotate: 270 }, 400 - 200 / 3, 450 - 400 / 3],
  ])("%s page: a stroke lands at the hand-derived PDF point; page 2 is inked too", async (_name, spec, x, y) => {
    const original = await makePdf([spec, { size: [500, 700] }]);
    const probe = await PDFDocument.load(original);
    const out = await exportAnnotatedPdf({ pdf: original, pages: [{ page: 1, strokes: [line(300, 200, 500, 200)] }, { page: 2, strokes: [line(10, 10, 60, 10)] }] });
    const after = await PDFDocument.load(out);
    expect(after.getPage(0).getRotation().angle).toBe(spec.rotate ?? 0);
    expect(after.getPage(0).getCropBox()).toEqual(probe.getPage(0).getCropBox());
    const stroke = pathPoints(pageContent(after, 0)).slice(pathPoints(pageContent(probe, 0)).length);
    expect(stroke.length).toBeGreaterThan(0);
    const c = bounds(stroke);
    near((c.minX + c.maxX) / 2, x, 2);
    near((c.minY + c.maxY) / 2, y, 2);
    expect(pageContent(after, 1).length).toBeGreaterThan(pageContent(probe, 1).length);
  });

  it("rotated page: stroke extent runs along the expected axis", async () => {
    const original = await makePdf([{ size: [600, 800], rotate: 90 }]);
    const out = await exportAnnotatedPdf({ pdf: original, pages: [{ page: 1, strokes: [line(300, 200, 500, 200)] }] });
    const after = await PDFDocument.load(out);
    const b = bounds(pathPoints(pageContent(after, 0)));
    // logical x runs along user y (scale 800/1200), logical y along user x: 300..500 -> y 200..333, x = 200 * 2/3 = 133
    near(b.minY, 200, 2); near(b.maxY, 333.3, 2);
    near((b.minX + b.maxX) / 2, 133.3, 2);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it("marks and math are drawn", async () => {
    const original = await makePdf([{ size: [600, 800] }]);
    const mark = roughMarkPaths("circle", { x: 100, y: 100, w: 200, h: 60 }, 7);
    expect(mark.paths.length).toBeGreaterThan(0);
    const out = await exportAnnotatedPdf({
      pdf: original,
      pages: [{ page: 1, marks: [mark], math: [{ x: 400, y: 300, width: 100, height: 50, viewBox: [0, 0, 1000, 500], paths: [{ d: "M0,0 L1000,0 L1000,500 Z" }] }] }],
    });
    const after = await PDFDocument.load(out);
    const content = pageContent(after, 0);
    const pts = pathPoints(content);
    const circle = bounds(pts.filter((p) => p.x < 200 && p.y > 600));
    expect(circle.minX).toBeLessThan(100); // pad pushes past the box (50 pt)
    // Math triangle: logical (400,300)-(500,350) -> user x 200..250, y 650..625
    const m = bounds(pts.filter((p) => Math.abs(p.x - 225) < 30 && p.y > 620 && p.y < 660));
    near(m.minX, 200, 0.5); near(m.maxX, 250, 0.5);
  });

  it("embeds Kalam when text exists, and not otherwise", async () => {
    const original = await makePdf([{ size: [600, 800] }]);
    const withText = await exportAnnotatedPdf({ pdf: original, fontBytes, pages: [{ page: 1, texts: [{ text: "check x = 3 ✓", x: 100, y: 100, size: 26 }] }] });
    const doc = await PDFDocument.load(withText);
    const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of("Font"));
    const names = fonts ? Array.from(doc.context.enumerateIndirectObjects()).map(([, o]) => String(o)).join("\n") : "";
    expect(names).toContain("Kalam");
    const without = await exportAnnotatedPdf({ pdf: original, pages: [{ page: 1, strokes: [line(0, 0, 10, 10)] }] });
    expect(Buffer.from(without).toString("latin1")).not.toContain("Kalam");
    await expect(exportAnnotatedPdf({ pdf: original, pages: [{ page: 1, texts: [{ text: "x", x: 0, y: 0, size: 20 }] }] })).rejects.toThrow(/fontBytes/);
  });

  it("rejects a page that is not in the PDF", async () => {
    const original = await makePdf([{ size: [600, 800] }]);
    await expect(exportAnnotatedPdf({ pdf: original, pages: [{ page: 2, strokes: [] }] })).rejects.toThrow(/Page 2/);
  });

  it("strokeOutlinePath is a closed path", () => {
    const d = strokeOutlinePath(line(0, 0, 100, 0));
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(strokeOutlinePath({ points: [] })).toBe("");
  });
});
