import { readFileSync } from "node:fs";
import { degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import type { Stroke } from "../../src/lib/contracts";
import { displayedPageToPdf, exportAnnotatedPdf } from "../../src/lib/ink/pdf-export";
import { rasterizePdfPage, readPdfText } from "../../src/lib/lms/pdf";

const stroke = (page: number): Stroke & { page: number } => ({
  id: `s${page}`, page, problemId: "p", rowId: null, tool: "pen", pointerType: "pen",
  points: [{ x: 100, y: 200, p: 0.5, t: 0 }, { x: 200, y: 200, p: 0.5, t: 100 }],
  t0: 0, t1: 100, bbox: { x: 100, y: 200, w: 100, h: 0 },
});
const point = (matrix: readonly number[], x: number, y: number) => [matrix[0]! * x + matrix[2]! * y + matrix[4]!, matrix[1]! * x + matrix[3]! * y + matrix[5]!];

it.each([
  [0, [70, 530]], [90, [170, 105]], [180, [370, 130]], [270, [270, 555]],
])("inverts displayed coordinates for crop origin and rotation %s", async (rotation, expected) => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.setCropBox(20, 30, 400, 600);
  page.setRotation(degrees(rotation as number));
  expect(point(displayedPageToPdf(page), 150, 300)).toEqual(expected);
});

it("preserves all original page boxes, rotations and content while appending filled outlines to each inked page", async () => {
  const original = await PDFDocument.create();
  for (const rotation of [0, 90]) {
    const page = original.addPage([612, 792]);
    page.setCropBox(20, 30, 400, 600); page.setRotation(degrees(rotation));
    page.drawText("Original printed problem", { x: 100, y: 300, size: 12 });
  }
  original.addPage([300, 500]);
  const bytes = await original.save();
  const result = await PDFDocument.load(await exportAnnotatedPdf({ originalPdf: bytes, strokes: [stroke(1), stroke(2)] }));
  expect(result.getPageCount()).toBe(3);
  for (let i = 0; i < 3; i++) {
    const page = result.getPage(i), before = original.getPage(i);
    expect(page.getMediaBox()).toEqual(before.getMediaBox());
    expect(page.getCropBox()).toEqual(before.getCropBox());
    expect(page.getRotation()).toEqual(before.getRotation());
    const content = page.node.Contents();
    if (i < 2) {
      expect(content).toBeInstanceOf(PDFArray);
      const contents = content as PDFArray;
      expect(contents.size()).toBeGreaterThan((before.node.Contents() as PDFArray).size());
      const streams = contents.asArray().map(ref => result.context.lookup(ref)).filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream);
      const ink = streams.map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join("\n");
      expect(ink).toContain("0.10588235294117647 0.10588235294117647 0.12156862745098039 rg");
      expect(ink).toMatch(/\nf\n/); // Filled perfect-freehand outline, not a thin centerline.
      const image = await loadImage(Buffer.from((await rasterizePdfPage(await result.save(), i + 1))!));
      const canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(150, 200, 1, 1).data;
      expect([...pixel.slice(0, 3)].every(channel => channel < 80)).toBe(true);
    } else expect(content).toBeUndefined();
  }
  expect((await readPdfText(await result.save())).flatMap(page => page.items).filter(item => item.str.includes("Original printed problem"))).toHaveLength(2);
}, 30_000);

it("embeds Kalam text and transformed MathJax/rough vector paths without raster images", async () => {
  const original = await PDFDocument.create(); original.addPage([600, 800]);
  const result = await PDFDocument.load(await exportAnnotatedPdf({
    originalPdf: await original.save(), strokes: [],
    fontBytes: new Uint8Array(readFileSync("public/fonts/Kalam-Regular.ttf")),
    annotations: [{ page: 1, elements: [
      { type: "text", text: "Try the substitution", x: 100, y: 120, size: 26, fill: "#c8321e" },
      { type: "path", d: "M0 0 L100 0 L50 100 Z", transform: [0.02, 0, 0, -0.02, 250, 130], fill: "#c8321e" },
      { type: "path", d: "M90 100 Q110 110 120 90", stroke: "#c8321e", strokeWidth: 2.5 },
    ] }],
  }));
  const text = await readPdfText(await result.save());
  expect(text[0]!.items.some(item => item.str.includes("Try the substitution"))).toBe(true);
  expect(result.getPage(0).node.Resources()!.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys() ?? []).toEqual([]);
});

it("ignores erased/eraser strokes and rejects non-existent annotation pages", async () => {
  const original = await PDFDocument.create(); original.addPage([600, 800]);
  const originalPdf = await original.save();
  const output = await PDFDocument.load(await exportAnnotatedPdf({ originalPdf, strokes: [{ ...stroke(1), erasedAt: 500 }, { ...stroke(1), tool: "eraser" }] }));
  expect(output.getPage(0).node.Contents()).toBeUndefined();
  await expect(exportAnnotatedPdf({ originalPdf, strokes: [stroke(2)] })).rejects.toThrow(/page/i);
});

it.each([false, true])("preserves below-page writing with an out-of-media crop %s", async (oversizedCrop) => {
  const original = await PDFDocument.create(); original.addPage([600, 800]);
  if (oversizedCrop) original.getPage(0).setCropBox(-50, -100, 800, 1200);
  const bytes = await exportAnnotatedPdf({ originalPdf: await original.save(), strokes: [],
    fontBytes: new Uint8Array(readFileSync("public/fonts/Kalam-Regular.ttf")),
    annotations: [{ page: 1, elements: [{ type: "text", text: "Check your differential", x: 24, y: 1660, size: 26,
      bounds: { x: 24, y: 1630, w: 300, h: 40 } }] }] });
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
  const text = await readPdfText(bytes);
  expect(text[1]!.items.some(item => item.str.includes("Albert notes"))).toBe(true);
  expect(text[1]!.items.some(item => item.str.includes("Check your differential"))).toBe(true);
  expect(text[0]!.items.some(item => item.str.includes("Check your differential"))).toBe(false);
});

it("keeps a whole note together at a page boundary and rejects notes too tall to export", async () => {
  const original = await PDFDocument.create(); original.addPage([600, 800]);
  const originalPdf = await original.save();
  const noteGroup = { id: "formula", bounds: { x: 24, y: 3059, w: 300, h: 100 } };
  const fontBytes = new Uint8Array(readFileSync("public/fonts/Kalam-Regular.ttf"));
  const bytes = await exportAnnotatedPdf({ originalPdf, strokes: [], fontBytes, annotations: [{ page: 1, elements: [
    { type: "text", text: "Top of formula", x: 24, y: 3080, size: 26, bounds: noteGroup.bounds, noteGroup },
    { type: "text", text: "Bottom of formula", x: 24, y: 3140, size: 26, bounds: { x: 24, y: 3110, w: 300, h: 40 }, noteGroup },
  ] }] });
  const text = await readPdfText(bytes);
  expect(text[1]!.items.map(i => i.str).join(" ")).toContain("Bottom of formula");
  expect(text[1]!.items.every(i => i.y >= 0 && i.y + i.height <= 1600)).toBe(true);
  await expect(exportAnnotatedPdf({ originalPdf, strokes: [], fontBytes, annotations: [{ page: 1, elements: [
    { type: "text", text: "Too tall", x: 0, y: 1700, size: 26, bounds: { x: 0, y: 1601, w: 300, h: 2000 } },
  ] }] })).rejects.toThrow(/too tall/i);
});
