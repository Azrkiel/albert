import { getStroke } from "perfect-freehand";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument, PDFPage, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb,
  type PDFFont,
} from "pdf-lib";
import rough from "roughjs";
import { INK, PAGE, type BBox } from "../contracts";
import { arrowFor, circleFor, underlineFor } from "./geometry";
import { hashSeed, type MarkKind } from "./marks";
import { textBaseline } from "./font";

/**
 * R2.4 annotated PDF export. Pure library: bytes in, bytes out, no DOM, no network, no clock. It is not wired to any
 * UI; the Save PDF button (canvas lane) maps its state to `PdfExportInput`.
 *
 * Logical space is the work surface: x in 0..PAGE.width (1200), y down from the top-left of the page AS DISPLAYED
 * (after /Rotate, inside the CropBox), height = 1200 x visibleHeight / visibleWidth. `pageTransform` maps it to PDF
 * user space. Drawing goes through one CTM per item, so SVG path data is emitted untouched in logical px.
 */

/** [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (PDF `cm` order). */
export type Matrix = readonly [number, number, number, number, number, number];
/** [x1, y1, x2, y2] in PDF user space, as in /MediaBox and /CropBox. */
export type Box = readonly [number, number, number, number];

export type PageGeometry = { mediaBox: Box; cropBox?: Box; rotate?: number };
export type PageTransform = {
  /** Logical size of the page as displayed: PAGE.width by 1200 x visibleHeight / visibleWidth. */
  width: number; height: number;
  /** PDF points per logical px. */
  scale: number;
  /** Logical (y down) to PDF user space. */
  matrix: Matrix;
  toPdf(x: number, y: number): { x: number; y: number };
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** a then b: applies `b` first, then `a` (the usual matrix product a x b). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const applyMatrix = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

const normalizeBox = (box: Box): Box => [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])];

/** The visible area: CropBox clipped to MediaBox (MediaBox when there is no CropBox or the clip is empty). */
export function visibleBox(geometry: PageGeometry): Box {
  const media = normalizeBox(geometry.mediaBox);
  if (!geometry.cropBox) return media;
  const crop = normalizeBox(geometry.cropBox);
  const clipped: Box = [Math.max(media[0], crop[0]), Math.max(media[1], crop[1]), Math.min(media[2], crop[2]), Math.min(media[3], crop[3])];
  return clipped[2] > clipped[0] && clipped[3] > clipped[1] ? clipped : media;
}

/** /Rotate snapped to 0, 90, 180 or 270 (PDF requires a multiple of 90; anything else is rounded). */
export const normalizeRotation = (rotate = 0): 0 | 90 | 180 | 270 =>
  ((((Math.round(rotate / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/**
 * Logical px to PDF user space for one page. Handles non-zero MediaBox/CropBox origins and /Rotate (clockwise, as
 * viewers display it), and flips y. Pure.
 */
export function pageTransform(geometry: PageGeometry): PageTransform {
  const [x1, y1, x2, y2] = visibleBox(geometry);
  const cw = x2 - x1, ch = y2 - y1;
  const rotate = normalizeRotation(geometry.rotate);
  const sideways = rotate === 90 || rotate === 270;
  const displayW = sideways ? ch : cw;
  const displayH = sideways ? cw : ch;
  const scale = displayW / PAGE.width;
  const s = scale;
  let matrix: Matrix;
  switch (rotate) {
    case 0: matrix = [s, 0, 0, -s, x1, y2]; break;           // top-left of the display = user top-left
    case 90: matrix = [0, s, s, 0, x1, y1]; break;           // display right = user up, display down = user right
    case 180: matrix = [-s, 0, 0, s, x2, y1]; break;         // display top-left = user bottom-right
    default: matrix = [0, -s, -s, 0, x2, y2]; break;         // 270: display right = user down, display down = user left
  }
  return {
    width: PAGE.width, height: PAGE.width * displayH / displayW, scale, matrix,
    toPdf: (x, y) => applyMatrix(matrix, x, y),
  };
}

/** Reads the geometry pdf-lib sees on a page (inherited MediaBox/Rotate included). */
export function geometryOf(page: PDFPage): PageGeometry {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  return {
    mediaBox: [media.x, media.y, media.x + media.width, media.y + media.height],
    cropBox: [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height],
    rotate: page.getRotation().angle,
  };
}

// ---- input ----------------------------------------------------------------------------------------------------

/** One pen point in logical px; `p` is pressure 0..1 (as `Point.p`). `t` is ignored, so a contract `Point` fits. */
export type ExportPoint = { x: number; y: number; p?: number };
export type ExportStroke = {
  points: readonly ExportPoint[];
  /** perfect-freehand size in logical px; 4 matches the surface (src/lib/canvas/path.ts). */
  width?: number;
  /** CSS hex colour; default INK.student. */
  color?: string;
};
/** Albert's mark: SVG path data in logical px (stroke only, rough). Use `roughMarkPaths` or the `d` of each rendered `<path>`. */
export type ExportMark = { paths: readonly string[]; strokeWidth?: number; color?: string };
/** Albert's hand text. (x, y) is the top-left of the line box, as for `textNode` (baseline at y + textBaseline(size)). */
export type ExportText = { text: string; x: number; y: number; size: number; color?: string };
/**
 * Math as pre-rendered glyph path data, so MathJax (browser-only, ~1 MB) stays out of this library. Take it from
 * `mathToSvg(latex, size).node`: `viewBox` is its `viewBox`, `width`/`height` its size in logical px, and each
 * `<path>` goes in `paths` with `matrix` = the product of the transforms of its ancestors inside that svg (identity
 * if none). (x, y) is the top-left of the math box in logical px. Filled.
 */
export type ExportMath = {
  x: number; y: number; width: number; height: number;
  viewBox: Box | readonly [number, number, number, number];
  paths: readonly { d: string; matrix?: Matrix }[];
  color?: string;
};
export type ExportPage = {
  /** 1-based page number in the original PDF. */
  page: number;
  strokes?: readonly ExportStroke[];
  marks?: readonly ExportMark[];
  texts?: readonly ExportText[];
  math?: readonly ExportMath[];
};
export type PdfExportInput = {
  /** The original PDF. */
  pdf: Uint8Array;
  pages: readonly ExportPage[];
  /** Kalam-Regular.ttf bytes (public/fonts/Kalam-Regular.ttf). Required when any page has `texts`. */
  fontBytes?: Uint8Array;
};

// ---- paths ----------------------------------------------------------------------------------------------------

/** The perfect-freehand outline as a closed SVG path (same smoothing as strokePath in src/lib/canvas/path.ts). */
export function strokeOutlinePath(stroke: ExportStroke): string {
  const outline = getStroke(stroke.points.map((pt) => [pt.x, pt.y, pt.p ?? 0.5]), {
    size: stroke.width ?? 4, thinning: 0.5, smoothing: 0.5, streamline: 0, simulatePressure: false, last: true,
  });
  const first = outline[0], last = outline[outline.length - 1];
  if (!first || !last) return "";
  const f = (n: number) => +n.toFixed(2);
  let path = `M${f((last[0]! + first[0]!) / 2)},${f((last[1]! + first[1]!) / 2)}`;
  for (let i = 0; i < outline.length; i++) {
    const point = outline[i]!, next = outline[(i + 1) % outline.length]!;
    path += `Q${f(point[0]!)},${f(point[1]!)} ${f((point[0]! + next[0]!) / 2)},${f((point[1]! + next[1]!) / 2)}`;
  }
  return `${path}Z`;
}

const gen = rough.generator();
const roughOpts = (seed: number, roughness: number, strokeWidth = 2.5) => ({ stroke: INK.albert, strokeWidth, fill: "none", seed, roughness });
const dOf = (drawable: ReturnType<typeof gen.line>) => gen.toPaths(drawable).map((p) => p.d).filter(Boolean);

/**
 * The same rough paths as marks.ts (same options, same seed), built without a DOM through roughjs's generator.
 * `seed` is `hashSeed(id)` for the mark's id, as on screen.
 */
export function roughMarkPaths(kind: MarkKind, target: BBox, seed: number, from?: { x: number; y: number }): ExportMark {
  const arrowSeed = Number.isFinite(seed) && seed > 0 ? seed : hashSeed(String(seed));
  switch (kind) {
    case "circle": {
      const { cx, cy, rx, ry } = circleFor(target);
      return { paths: dOf(gen.ellipse(cx, cy, 2 * rx, 2 * ry, roughOpts(seed, 1.6))) };
    }
    case "underline": {
      const { x1, y1, x2, y2 } = underlineFor(target);
      return { paths: dOf(gen.line(x1, y1, x2, y2, { ...roughOpts(seed, 1.4), disableMultiStroke: false })) };
    }
    case "cross_out": {
      const pad = 5;
      return { paths: dOf(gen.line(target.x - pad, target.y + target.h + pad, target.x + target.w + pad, target.y - pad, roughOpts(seed, 1.2))) };
    }
    default: {
      const { path, head } = arrowFor(from ?? { x: target.x + target.w + 80, y: target.y + target.h / 2 }, target);
      return { paths: [
        ...gen.toPaths(gen.path(path, roughOpts(arrowSeed, 0.9))).map((p) => p.d),
        ...head.flatMap((d, i) => gen.toPaths(gen.path(d, roughOpts(arrowSeed + i + 1, 0.6))).map((p) => p.d)),
      ].filter(Boolean) };
    }
  }
}

// ---- drawing --------------------------------------------------------------------------------------------------

function hexColor(hex: string | undefined, fallback: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? fallback).trim()) ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1]!, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const FLIP: Matrix = [1, 0, 0, -1, 0, 0];

/**
 * Draws SVG path data whose coordinates are `local` (y down) coordinates, where `local` maps to PDF user space via
 * `m`. pdf-lib's drawSvgPath emits (x, -y) in the current CTM, so the CTM is m x local x flip: (px, -py) lands at
 * m x local x (px, py).
 */
function drawPath(page: PDFPage, d: string, m: Matrix, opts: { fill?: ReturnType<typeof rgb>; stroke?: ReturnType<typeof rgb>; width?: number }) {
  if (!d) return;
  const cm = multiply(m, FLIP);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...cm));
  page.drawSvgPath(d, {
    x: 0, y: 0, scale: 1,
    ...(opts.fill ? { color: opts.fill } : {}),
    ...(opts.stroke ? { borderColor: opts.stroke, borderWidth: opts.width ?? 1, borderLineCap: 1 } : {}),
  });
  page.pushOperators(popGraphicsState());
}

const printable = (font: PDFFont, text: string) => {
  const set = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\r?\n/g, " ")).map((ch) => (set.has(ch.codePointAt(0)!) ? ch : "?")).join("");
};

/** Returns the annotated PDF. Page order, count, sizes, boxes and /Rotate are untouched; only inked pages gain content. */
export async function exportAnnotatedPdf(input: PdfExportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.pdf);
  const pages = doc.getPages();
  const wantsText = input.pages.some((p) => (p.texts ?? []).some((t) => t.text.trim()));
  let font: PDFFont | null = null;
  if (wantsText) {
    if (!input.fontBytes) throw new Error("fontBytes is required to draw text");
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(input.fontBytes, { subset: true });
  }
  for (const entry of input.pages) {
    const page = pages[entry.page - 1];
    if (!page) throw new Error(`Page ${entry.page} is not in the PDF (${pages.length} pages)`);
    const { matrix } = pageTransform(geometryOf(page));
    for (const stroke of entry.strokes ?? []) {
      if (stroke.points.length === 0) continue;
      drawPath(page, strokeOutlinePath(stroke), matrix, { fill: hexColor(stroke.color, INK.student) });
    }
    for (const mark of entry.marks ?? []) {
      for (const d of mark.paths) drawPath(page, d, matrix, { stroke: hexColor(mark.color, INK.albert), width: mark.strokeWidth ?? 2.5 });
    }
    for (const item of entry.texts ?? []) {
      if (!font || !item.text.trim()) continue;
      // Text space is y up; logical is y down, so flip around the baseline.
      const cm = multiply(matrix, [1, 0, 0, -1, item.x, item.y + textBaseline(item.size)]);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...cm));
      page.drawText(printable(font, item.text), { x: 0, y: 0, size: item.size, font, color: hexColor(item.color, INK.albert) });
      page.pushOperators(popGraphicsState());
    }
    for (const math of entry.math ?? []) {
      const [vx, vy, vw, vh] = math.viewBox;
      const place = multiply(matrix, multiply([1, 0, 0, 1, math.x, math.y], [math.width / vw, 0, 0, math.height / vh, -vx * math.width / vw, -vy * math.height / vh]));
      for (const glyph of math.paths) drawPath(page, glyph.d, multiply(place, glyph.matrix ?? IDENTITY), { fill: hexColor(math.color, INK.albert) });
    }
  }
  return doc.save();
}

