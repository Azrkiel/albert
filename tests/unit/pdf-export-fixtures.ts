import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream, degrees, StandardFonts } from "pdf-lib";

/** `cropBox` is [x1, y1, x2, y2] in user space, as in the PDF /CropBox entry. */
export type FixturePage = { size: [number, number]; mediaOrigin?: [number, number]; cropBox?: [number, number, number, number]; rotate?: number };

/** Deterministic PDF built with pdf-lib: one page per spec, each with a line of Helvetica text so it has content. */
export async function makePdf(pages: FixturePage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((spec, i) => {
    const page = doc.addPage(spec.size);
    if (spec.mediaOrigin) page.setMediaBox(spec.mediaOrigin[0], spec.mediaOrigin[1], spec.size[0], spec.size[1]);
    if (spec.cropBox) {
      const [x1, y1, x2, y2] = spec.cropBox;
      page.setCropBox(x1, y1, x2 - x1, y2 - y1); // pdf-lib takes x, y, width, height
    }
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    const [x, y] = spec.mediaOrigin ?? [0, 0];
    page.drawText(`Page ${i + 1}`, { x: x + 20, y: y + 20, size: 12, font });
  });
  return doc.save({ useObjectStreams: false });
}

/** All content stream bytes of a page, decoded, concatenated in order. */
export function pageContent(doc: PDFDocument, index: number): string {
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? contents.asArray().map((ref) => doc.context.lookup(ref))
    : contents ? [contents] : [];
  return streams.map((s) => {
    if (s instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");
    if (s instanceof PDFStream) return Buffer.from(s.getContents()).toString("latin1");
    return "";
  }).join("\n");
}

export { PDFName };

/**
 * Minimal content-stream interpreter: tracks q/Q/cm and returns every path point (m, l, c, v, y) in PDF user space.
 * Enough to read what pdf-lib's drawSvgPath emits.
 */
export function pathPoints(content: string): { x: number; y: number }[] {
  type M = [number, number, number, number, number, number];
  const mul = (a: M, b: M): M => [
    b[0] * a[0] + b[1] * a[2], b[0] * a[1] + b[1] * a[3],
    b[2] * a[0] + b[3] * a[2], b[2] * a[1] + b[3] * a[3],
    b[4] * a[0] + b[5] * a[2] + a[4], b[4] * a[1] + b[5] * a[3] + a[5],
  ];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const out: { x: number; y: number }[] = [];
  const nums: number[] = [];
  let inText = false;
  for (const tok of content.split(/\s+/)) {
    if (!tok) continue;
    if (/^-?\d*\.?\d+(e-?\d+)?$/i.test(tok)) { nums.push(Number(tok)); continue; }
    if (tok === "BT") inText = true;
    else if (tok === "ET") inText = false;
    else if (tok === "q") stack.push(ctm);
    else if (tok === "Q") ctm = stack.pop() ?? ctm;
    else if (tok === "cm" && nums.length >= 6) ctm = mul(ctm, nums.slice(-6) as M);
    else if (!inText && ["m", "l", "c", "v", "y"].includes(tok)) {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        out.push({ x: ctm[0] * nums[i]! + ctm[2] * nums[i + 1]! + ctm[4], y: ctm[1] * nums[i]! + ctm[3] * nums[i + 1]! + ctm[5] });
      }
    }
    nums.length = 0;
  }
  return out;
}

export const bounds = (pts: { x: number; y: number }[]) => ({
  minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
});
