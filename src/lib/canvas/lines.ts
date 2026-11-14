import { LINE, PAGE, type BBox, type Row, type Stroke } from "../contracts";
import { FRACTION_BAR_MIN_ASPECT } from "./clusters";

/** Lines inferred from ink (contracts.md §2, Line assignment). Pure: no DOM, clock or IO. */

type Band = { rowId: string; n: number; top: number; bottom: number; strokes: Stroke[] };

const bottomOf = (box: BBox) => box.y + box.h;
const rightOf = (box: BBox) => box.x + box.w;
const centerX = (box: BBox) => box.x + box.w / 2;
const isLive = (stroke: Stroke) => stroke.tool === "pen" && stroke.erasedAt === undefined;
const isFlat = (box: BBox) => box.w > 0 && box.w >= FRACTION_BAR_MIN_ASPECT * box.h;

/** The creation number in `${problemId}/r${n}`; ids are opaque elsewhere, so unknown shapes sort last. */
function lineNumber(rowId: string): number {
  const match = /\/r(\d+)$/.exec(rowId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Vertical gap between two boxes; 0 when they overlap. */
function verticalGap(a: BBox, b: BBox): number {
  return Math.max(0, Math.max(a.y, b.y) - Math.min(bottomOf(a), bottomOf(b)));
}

function bands(strokes: Stroke[], problemId: string, live: boolean): Band[] {
  const byRow = new Map<string, Stroke[]>();
  for (const stroke of strokes) {
    if (stroke.problemId !== problemId || !stroke.rowId || stroke.tool !== "pen") continue;
    if (live && stroke.erasedAt !== undefined) continue;
    byRow.set(stroke.rowId, [...(byRow.get(stroke.rowId) ?? []), stroke]);
  }
  return [...byRow].map(([rowId, members]) => ({
    rowId, n: lineNumber(rowId), strokes: members,
    top: Math.min(...members.map((s) => s.bbox.y)),
    bottom: Math.max(...members.map((s) => bottomOf(s.bbox))),
  }));
}

/** Overlap as a share of the shorter height. A zero-height stroke inside the band counts as full overlap. */
function overlapShare(box: BBox, band: Band): number {
  const overlap = Math.min(bottomOf(box), band.bottom) - Math.max(box.y, band.top);
  if (overlap < 0) return 0;
  const shorter = Math.min(box.h, band.bottom - band.top);
  return shorter <= 0 ? 1 : overlap / shorter;
}

/** Median height of a line's glyphs, ignoring flat strokes (bars, minus signs); the band height if none. */
function glyphHeight(line: Band): number {
  const heights = line.strokes.filter((s) => !isFlat(s.bbox)).map((s) => s.bbox.h).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)]! : line.bottom - line.top;
}

/** A finished pen stroke's line: an existing line's id, or a new one. Decided once; never revisited. */
export function assignLine(stroke: Stroke, strokes: Stroke[]): string {
  const lines = bands(strokes.filter((s) => s.id !== stroke.id), stroke.problemId, true);
  const box = stroke.bbox;
  const middle = box.y + box.h / 2;
  const nearer = (a: Band, b: Band) =>
    Math.abs((a.top + a.bottom) / 2 - middle) - Math.abs((b.top + b.bottom) / 2 - middle) || a.n - b.n;

  // 1. Most vertical overlap; or the stroke's centre within LINE.REACH glyph heights of the line's ink
  //    (descenders, subscripts, tails hanging just below or above).
  const reaches = (line: Band) => {
    const reach = LINE.REACH * glyphHeight(line);
    return middle >= line.top - reach && middle <= line.bottom + reach;
  };
  const overlapping = lines.map((line) => ({ line, share: overlapShare(box, line) }))
    .filter(({ line, share }) => share >= LINE.MIN_OVERLAP || reaches(line))
    .sort((a, b) => b.share - a.share || nearer(a.line, b.line));
  if (overlapping[0]) return overlapping[0].line.rowId;

  // 2. Fraction parts join their bar's line, in any writing order.
  const fraction = lines.flatMap((line) => line.strokes.flatMap((other) => {
    const gap = verticalGap(box, other.bbox);
    const overBar = isFlat(other.bbox) && centerX(box) >= other.bbox.x && centerX(box) <= rightOf(other.bbox);
    const isBar = isFlat(box) && centerX(other.bbox) >= box.x && centerX(other.bbox) <= rightOf(box);
    if (!overBar && !isBar) return [];
    // Bigger writing leaves bigger gaps around a bar: scale with the height of the part that is not the bar.
    const partHeight = overBar ? box.h : other.bbox.h;
    return gap <= Math.max(LINE.GAP, LINE.GAP_PER_HEIGHT * partHeight) ? [{ line, gap }] : [];
  })).sort((a, b) => a.gap - b.gap || a.line.n - b.line.n);
  if (fraction[0]) return fraction[0].line.rowId;

  // 3. A new line; numbers are never reused, including lines whose ink is all erased.
  const used = strokes.filter((s) => s.problemId === stroke.problemId && s.rowId).map((s) => lineNumber(s.rowId!));
  const next = Math.max(0, ...used.filter(Number.isFinite).filter((n) => n < Number.MAX_SAFE_INTEGER)) + 1;
  return `${stroke.problemId}/r${next}`;
}

/**
 * Rows for the free layout, in problem order then index. Lines with live ink are numbered 1..k top
 * to bottom; lines whose ink is all erased keep a row (so undo can restore them) and come after.
 */
export function lineRows(problemIds: string[], strokes: Stroke[]): Row[] {
  return problemIds.flatMap((problemId) => {
    const all = bands(strokes, problemId, false);
    const live = new Map(bands(strokes, problemId, true).map((band) => [band.rowId, band]));
    const order = (a: Band, b: Band) => a.top - b.top || a.n - b.n;
    const ordered = [...all.filter((b) => live.has(b.rowId)).map((b) => live.get(b.rowId)!).sort(order),
      ...all.filter((b) => !live.has(b.rowId)).sort(order)];
    return ordered.map((band, i) => ({
      id: band.rowId, problemId, index: i + 1,
      bbox: { x: PAGE.studentCol.x, y: band.top - LINE.PAD, w: PAGE.studentCol.w, h: band.bottom - band.top + 2 * LINE.PAD },
    }));
  });
}

/** Rows that currently hold live ink. */
export function inkedRowIds(strokes: Stroke[]): Set<string> {
  return new Set(strokes.filter(isLive).flatMap((s) => (s.rowId ? [s.rowId] : [])));
}

/** Free layout keeps a blank page to start and two line heights of space below the lowest ink. */
export function freeSurfaceHeight(rows: Row[]): number {
  const lowest = Math.max(PAGE.statementMinHeight, ...rows.map((row) => row.bbox.y + row.bbox.h));
  return Math.max(PAGE.statementMinHeight + 4 * PAGE.rowHeight, lowest + 2 * PAGE.rowHeight);
}
