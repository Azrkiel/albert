import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFString, StandardFonts, degrees } from "pdf-lib";
import { decodePDFRawStream } from "pdf-lib";
import type { Stroke } from "../../src/lib/contracts";
import { addEditablePdfInk } from "../../src/lib/canvas/editable-pdf-ink";
import { mapCanvasToPdf, planNotePages, NOTE_PAGE, type PdfNote } from "../../src/lib/canvas/pdf-export-input";
import { buildPdfDownload } from "../../src/lib/canvas/pdf-download";
import { pageTransform, geometryOf } from "../../src/lib/ink/pdf-export";

const fontBytes = new Uint8Array(readFileSync("public/fonts/Kalam-Regular.ttf"));
function stroke(id: string, page = 1): Stroke {
  return { id, page, problemId: "p1", rowId: "p1/r1", tool: "pen", pointerType: "pen", t0: 0, t1: 10,
    points: [{ x: 100, y: 300, t: 0, p: 0.3 }, { x: 160, y: 330, t: 10, p: 0.8 }], bbox: { x: 100, y: 300, w: 60, h: 30 } };
}
async function original() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText("Original page 1", { x: 40, y: 700, size: 12, font });
  const second = doc.addPage([700, 500]);
  second.setCropBox(20, 30, 600, 400); second.setRotation(degrees(90));
  second.drawText("Original page 2", { x: 50, y: 400, size: 12, font });
  return doc.save();
}
function contents(doc: PDFDocument, n: number): string[] {
  const raw = doc.getPage(n).node.Contents();
  const streams = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
  return streams.map(ref => {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error("Missing content stream");
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  });
}
function annots(doc: PDFDocument, n: number): PDFDict[] {
  return (doc.getPage(n).node.Annots()?.asArray() ?? []).map(ref => doc.context.lookup(ref, PDFDict));
}
function numbers(array: PDFArray): number[] { return array.asArray().map(v => (v as PDFNumber).asNumber()); }
const note = (id: string, page: number, y: number, h = 100): PdfNote => ({ id, page,
  bbox: { x: 16, y, w: 700, h }, texts: [{ text: `Hint ${id}`, x: 16, y, size: 26 }],
  math: [{ x: 200, y: y + 40, width: 100, height: 40, viewBox: [0, 0, 100, 40], paths: [{ d: "M0 0 L100 40" }] }],
});

describe("R2.4 canvas mapping", () => {
  it("maps live pen ink, marks, text and math to their exact pages", () => {
    const a = stroke("a"), b = stroke("b", 2), erased = { ...stroke("erased"), erasedAt: 30 };
    const eraser = { ...stroke("eraser"), tool: "eraser" as const }, unpaged = { ...stroke("unpaged"), page: undefined };
    const mark = { paths: ["M10 10 L40 40"] }, text = { text: "Look here", x: 20, y: 30, size: 26 };
    const m = note("a", 2, 1600).math[0]!;
    const result = mapCanvasToPdf([a, b, erased, eraser, unpaged], [{ page: 2, marks: [mark], texts: [text], math: [m], notes: [note("n", 2, 1600)] }], [1, 2]);
    expect(result.pages[0]).toEqual({ page: 1, strokes: [{ points: a.points }], marks: [], texts: [], math: [] });
    expect(result.pages[1]).toEqual({ page: 2, strokes: [{ points: b.points }], marks: [mark], texts: [text], math: [m] });
    expect(result.notes.map(n => n.id)).toEqual(["n"]);
    expect(a.erasedAt).toBeUndefined();
  });
  it("retains an uninked page and ignores annotations for missing pages", () => {
    expect(mapCanvasToPdf([], [{ page: 99, notes: [note("bad", 99, 100)] }], [1])).toEqual({ pages: [{ page: 1, strokes: [], marks: [], texts: [], math: [] }], notes: [] });
  });
});

describe("labelled note pages", () => {
  it("adds nothing without notes, and numbers appendices after the originals", () => {
    expect(planNotePages([], 2)).toEqual([]);
    const plans = planNotePages([note("b", 2, 1700), note("a", 1, 1600)], 2);
    expect(plans.map(p => [p.page, p.sourcePage])).toEqual([[3, 1], [4, 2]]);
    expect(plans[0]!.texts?.[0]?.text).toBe("Albert notes for page 1");
    expect(plans[0]!.texts?.[1]?.y).toBe(NOTE_PAGE.header);
    expect(plans[0]!.math?.[0]?.y).toBe(NOTE_PAGE.header + 40);
  });
  it("moves a whole note to the next page instead of clipping it", () => {
    const plans = planNotePages([note("a", 1, 1600, 900), note("b", 1, 2600, 900)], 2);
    expect(plans).toHaveLength(2);
    expect(plans[1]!.texts?.[1]?.text).toBe("Hint b");
    expect(plans[1]!.texts?.[1]?.y).toBe(NOTE_PAGE.header);
  });
  it("scales an oversized note as a unit while retaining all text and math", () => {
    const n = note("tall", 1, 1600, 5000);
    const plans = planNotePages([n], 1);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.texts?.[1]?.size).toBeLessThan(26);
    expect(plans[0]!.math?.[0]?.width).toBeLessThan(100);
    expect(plans[0]!.texts?.[1]?.text).toBe("Hint tall");
    expect(n.texts[0]!.size).toBe(26);
  });
});

describe("native editable PDF ink", () => {
  it("preserves original content, page count, sizes, crop and rotation while adding Ink annotations", async () => {
    const bytes = await original();
    const before = await PDFDocument.load(bytes);
    const after = await PDFDocument.load(await addEditablePdfInk(bytes, [stroke("one"), stroke("two", 2)]));
    expect(after.getPageCount()).toBe(2);
    for (const n of [0, 1]) {
      expect(geometryOf(after.getPage(n))).toEqual(geometryOf(before.getPage(n)));
      expect(contents(after, n)).toEqual(contents(before, n));
      expect(annots(after, n)).toHaveLength(1);
      const ink = annots(after, n)[0]!;
      expect(ink.get(PDFName.of("Subtype"))).toEqual(PDFName.of("Ink"));
      expect((ink.get(PDFName.of("NM")) as PDFString).decodeText()).toBe(n === 0 ? "one" : "two");
      const expected = stroke("x", n + 1).points.flatMap(p => { const q = pageTransform(geometryOf(before.getPage(n))).toPdf(p.x, p.y); return [q.x, q.y]; });
      const path = ink.lookup(PDFName.of("InkList"), PDFArray).lookup(0, PDFArray);
      numbers(path).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!));
      const ap = after.context.lookup(ink.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N")));
      if (!(ap instanceof PDFRawStream)) throw new Error("Missing appearance stream");
      expect(new TextDecoder().decode(decodePDFRawStream(ap).decode())).toContain("cm");
      expect(ink.lookup(PDFName.of("F"), PDFNumber).asNumber()).toBe(4); // Printable, not locked/read-only.
    }
  });
  it("omits erased/eraser/unpaged ink and keeps taps as editable dots", async () => {
    const dot = stroke("dot"); dot.points = [dot.points[0]!];
    const output = await addEditablePdfInk(await original(), [dot, { ...stroke("e"), erasedAt: 1 }, { ...stroke("eraser"), tool: "eraser" }, { ...stroke("old"), page: undefined }]);
    const doc = await PDFDocument.load(output);
    expect(annots(doc, 0)).toHaveLength(1);
    const path = annots(doc, 0)[0]!.lookup(PDFName.of("InkList"), PDFArray).lookup(0, PDFArray);
    expect(numbers(path)).toHaveLength(4);
  });
  it("preserves existing PDF annotations when new student ink is added", async () => {
    const once = await addEditablePdfInk(await original(), [stroke("existing")]);
    const doc = await PDFDocument.load(await addEditablePdfInk(once, [stroke("new")]));
    expect(annots(doc, 0).map(a => (a.get(PDFName.of("NM")) as PDFString).decodeText())).toEqual(["existing", "new"]);
  });
});

it("R2.4: the final download retains both original pages and appends visible labelled note content", async () => {
  const bytes = await original();
  const output = await buildPdfDownload({ pdf: bytes, fontBytes, strokes: [stroke("one"), stroke("two", 2)],
    albert: [{ page: 2, marks: [{ paths: ["M100 200 L140 220"] }], notes: [note("hint", 2, 1600)] }] });
  const doc = await PDFDocument.load(output), before = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(3);
  expect(geometryOf(doc.getPage(0))).toEqual(geometryOf(before.getPage(0)));
  expect(geometryOf(doc.getPage(1))).toEqual(geometryOf(before.getPage(1)));
  expect(annots(doc, 0)).toHaveLength(1);
  expect(annots(doc, 1)).toHaveLength(1);
  expect(contents(doc, 2).join("\n").length).toBeGreaterThan(100);
  expect(doc.getPage(2).getSize()).toEqual({ width: 612, height: 792 });
});


it("native ink appearance renders at the displayed coordinates on both cropped/rotated and normal pages", async () => {
  const { rasterizePdfPage } = await import("../../src/lib/lms/pdf");
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const bytes = await original();
  const output = await addEditablePdfInk(bytes, [stroke("one"), stroke("two", 2)]);
  async function black(png: Uint8Array) {
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(94, 294, 74, 44).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 100 && data[i + 1]! < 100 && data[i + 2]! < 100) count++;
    return count;
  }
  for (const page of [1, 2]) {
    expect(await black((await rasterizePdfPage(bytes, page))!)).toBe(0);
    expect(await black((await rasterizePdfPage(output, page))!)).toBeGreaterThan(50);
  }
}, 30000);
