import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PAGE } from "../contracts";
import type { PageSize, PageTextItem } from "./regions";

/** Byte input only: parsing/rendering never falls back to a remote file URL. */
async function withPdf<T>(bytes: Uint8Array, run: (document: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const canvas = await import("@napi-rs/canvas");
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try { return await run(await task.promise); }
  finally { await task.destroy(); }
}

export async function pdfPageSizes(bytes: Uint8Array): Promise<PageSize[]> {
  return withPdf(bytes, async document => {
    const sizes: PageSize[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push({ page: n, widthPt: viewport.width, heightPt: viewport.height });
      page.cleanup();
    }
    return sizes;
  });
}

export async function readPdfText(bytes: Uint8Array): Promise<Array<PageSize & { items: PageTextItem[] }>> {
  return withPdf(bytes, async document => {
    const pages: Array<PageSize & { items: PageTextItem[] }> = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PageTextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const [a, b, , , x, y] = item.transform as [number, number, number, number, number, number];
        const angle = Math.atan2(b, a), cos = Math.cos(angle), sin = Math.sin(angle);
        const corners = ([[0, 0], [item.width, 0], [0, item.height], [item.width, item.height]] as const)
          .map(([w, h]) => viewport.convertToViewportPoint(x + w * cos - h * sin, y + w * sin + h * cos));
        const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
        items.push({ str: item.str, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
      }
      pages.push({ page: n, widthPt: viewport.width, heightPt: viewport.height, items });
      page.cleanup();
    }
    return pages;
  });
}

async function render(page: PDFPageProxy, scale: number) {
  const canvas = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
  // Bound native memory before allocation; a tiny PDF can describe an extremely tall page.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
      width > 16_384 || height > 16_384 || width * height > 16_000_000) {
    throw new Error("PDF page exceeds the supported rendering dimensions.");
  }
  const target = canvas.createCanvas(width, height);
  await page.render({ canvasContext: target.getContext("2d") as unknown as CanvasRenderingContext2D, viewport, canvas: target as unknown as HTMLCanvasElement }).promise;
  return target;
}

/** P6.1 reader fallback: retain its public signature, page order, size cap and byte limit. */
export async function rasterizePdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  return withPdf(bytes, async document => {
    const images: Uint8Array[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const original = page.getViewport({ scale: 1 });
      const target = await render(page, Math.min(2, 3000 / Math.max(original.width, original.height)));
      const png = new Uint8Array(target.toBuffer("image/png"));
      if (png.length > 3_750_000) throw new Error(`Rendered page ${n} exceeds the Bedrock 3.75 MB image limit.`);
      images.push(png);
      page.cleanup();
    }
    return images;
  });
}

/** Supersample at 2x, then serve the AC2-required 1200px raster in logical page coordinates. */
export async function rasterizePdfPage(bytes: Uint8Array, n: number): Promise<Uint8Array | null> {
  return withPdf(bytes, async document => {
    if (!Number.isSafeInteger(n) || n < 1 || n > document.numPages) return null;
    const page = await document.getPage(n);
    const original = page.getViewport({ scale: 1 });
    const highResolution = await render(page, PAGE.width * 2 / original.width);
    const canvas = await import("@napi-rs/canvas");
    const target = canvas.createCanvas(PAGE.width, Math.max(1, Math.round(PAGE.width * original.height / original.width)));
    const context = target.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(highResolution, 0, 0, target.width, target.height);
    page.cleanup();
    return new Uint8Array(target.toBuffer("image/png"));
  });
}
