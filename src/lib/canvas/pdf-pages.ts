import { PAGE, type BBox, type Point, type Row, type Stroke, type Worksheet } from "../contracts";
import { assignLine, lineRows } from "./lines";

export type PdfPage = { page: number; widthPt: number; heightPt: number };
export type PdfProblem = Pick<Worksheet["problems"][number], "id" | "region">;

export function pageHeight(page: PdfPage): number { return PAGE.width * page.heightPt / page.widthPt; }
/** Displayed PDF points (top-left, after crop/rotation normalization), not raw PDF user space. */
export function pageToLogical(point: { x: number; y: number }, page: PdfPage) {
  return { x: point.x * PAGE.width / page.widthPt, y: point.y * PAGE.width / page.widthPt };
}
export function logicalToPage(point: { x: number; y: number }, page: PdfPage) {
  return { x: point.x * page.widthPt / PAGE.width, y: point.y * page.widthPt / PAGE.width };
}

/** Fraction of a segment inside a rectangle; measures ink length rather than sampling density. */
function insideFraction(a: Point, b: Point, box: BBox): number {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, box.x, box.x + box.w], [a.y, b.y - a.y, box.y, box.y + box.h]]) {
    if (delta === 0) { if (start! < min! || start! > max!) return 0; }
    else {
      const ends = [(min! - start!) / delta!, (max! - start!) / delta!];
      lo = Math.max(lo, Math.min(...ends)); hi = Math.min(hi, Math.max(...ends));
      if (hi <= lo) return 0;
    }
  }
  return hi - lo;
}

/** Most ink wins; ties keep printed order. Unlabelled whitespace uses the per-page picker. */
export function problemForStroke(stroke: Pick<Stroke, "points" | "page">, problems: PdfProblem[], fallback: string): string {
  let owner = fallback, most = 0;
  for (const problem of problems) {
    if (!problem.region || problem.region.page !== stroke.page) continue;
    const box = problem.region.bbox;
    const points = stroke.points;
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      length += Math.hypot(b.x - a.x, b.y - a.y) * insideFraction(a, b, box);
    }
    if (points.length && points.every(p => p.x === points[0]!.x && p.y === points[0]!.y)) {
      const p = points[0]!;
      length = p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y < box.y + box.h ? 1 : 0;
    }
    if (length > most) { most = length; owner = problem.id; }
  }
  return owner;
}

/** Reuse line inference in an isolated page, with unique stable ids across pages. */
export function assignPageLine(stroke: Stroke, strokes: Stroke[]): string {
  const local = strokes.filter(s => s.page === stroke.page);
  const id = assignLine(stroke, local);
  return local.some(s => s.rowId === id) ? id : id.replace(/\/r(\d+)$/, `/page${stroke.page}/r$1`);
}
export function pageRows(problemIds: string[], strokes: Stroke[]): Row[] {
  const pages = [...new Set(strokes.map(s => s.page))].sort((a, b) => (a ?? 0) - (b ?? 0));
  return pages.flatMap(page => lineRows(problemIds, strokes.filter(s => s.page === page), true).map(row => ({
    ...row, page,
  })));
}

/** Notes always start below the printed page, irrespective of the last inked line. */
export function pdfNoteBand(height: number): number { return height + 16; }
