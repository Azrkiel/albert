import { LINE, PAGE, type BBox, type Row, type Stroke } from "../contracts";
import { dividerIds, isFlat } from "./shapes";

/** Lines inferred from ink (contracts.md §2, Line assignment; dividers P2.5b). Pure: no DOM, clock or IO. */

type Band = { rowId: string; n: number; top: number; bottom: number; left: number; right: number; strokes: Stroke[] };

const bottomOf = (box: BBox) => box.y + box.h;
const rightOf = (box: BBox) => box.x + box.w;
const centerX = (box: BBox) => box.x + box.w / 2;
const centerY = (box: BBox) => box.y + box.h / 2;
const isLive = (stroke: Stroke) => stroke.tool === "pen" && stroke.erasedAt === undefined;

/** Live dividers of a problem. */
function dividersOf(strokes: Stroke[], problemId: string, ids: Set<string>): Stroke[] {
  return strokes.filter((s) => s.problemId === problemId && isLive(s) && ids.has(s.id));
}

/** A divider between the two strokes' centres whose height covers both of them. */
function separated(a: Stroke, b: Stroke, dividers: Stroke[]): boolean {
  const [lo, hi] = [Math.min(centerX(a.bbox), centerX(b.bbox)), Math.max(centerX(a.bbox), centerX(b.bbox))];
  return dividers.some((d) => d.id !== a.id && d.id !== b.id && centerX(d.bbox) > lo && centerX(d.bbox) < hi
    && [a, b].every((s) => centerY(s.bbox) >= d.bbox.y && centerY(s.bbox) <= bottomOf(d.bbox)));
}

/** The creation number in `${problemId}/r${n}`; ids are opaque elsewhere, so unknown shapes sort last. */
function lineNumber(rowId: string): number {
  const match = /\/r(\d+)$/.exec(rowId);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Vertical gap between two boxes; 0 when they overlap. */
function verticalGap(a: BBox, b: BBox): number {
  return Math.max(0, Math.max(a.y, b.y) - Math.min(bottomOf(a), bottomOf(b)));
}

/** Line bands from ordinary ink (dividers excluded). */
function bands(strokes: Stroke[], problemId: string, live: boolean, dividers: Set<string>): Band[] {
  const byRow = new Map<string, Stroke[]>();
  for (const stroke of strokes) {
    if (stroke.problemId !== problemId || !stroke.rowId || stroke.tool !== "pen" || dividers.has(stroke.id)) continue;
    if (live && stroke.erasedAt !== undefined) continue;
    byRow.set(stroke.rowId, [...(byRow.get(stroke.rowId) ?? []), stroke]);
  }
  return [...byRow].map(([rowId, members]) => ({
    rowId, n: lineNumber(rowId), strokes: members,
    top: Math.min(...members.map((s) => s.bbox.y)),
    bottom: Math.max(...members.map((s) => bottomOf(s.bbox))),
    left: Math.min(...members.map((s) => s.bbox.x)),
    right: Math.max(...members.map((s) => rightOf(s.bbox))),
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

/**
 * A finished pen stroke's line: an existing line's id, or a new one. Decided once; never revisited.
 * A divider gets a row of its own. Ink on the other side of a divider (within its height) is ignored,
 * so side work at the same height as the main column starts its own lines.
 */
export function assignLine(stroke: Stroke, strokes: Stroke[]): string {
  const ids = dividerIds([...strokes.filter((s) => s.id !== stroke.id), stroke]);
  const dividers = dividersOf(strokes, stroke.problemId, ids);
  const visible = ids.has(stroke.id) ? [] : strokes.filter((s) => s.id !== stroke.id && !separated(stroke, s, dividers));
  const lines = bands(visible, stroke.problemId, true, ids);
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
    const bar = isFlat(other.bbox) ? other.bbox : isFlat(box) ? box : null;
    if (!bar) return [];
    const part = bar === box ? other.bbox : box;
    // Bigger writing leaves bigger gaps around a bar: scale with the height of the part that is not the bar.
    // The same tolerance applies sideways, so an opening "(" just left of the bar's start still counts.
    const tolerance = Math.max(LINE.GAP, LINE.GAP_PER_HEIGHT * part.h);
    const under = centerX(part) >= bar.x - tolerance && centerX(part) <= rightOf(bar) + tolerance;
    return under && gap <= tolerance ? [{ line, gap }] : [];
  })).sort((a, b) => a.gap - b.gap || a.line.n - b.line.n);
  if (fraction[0]) return fraction[0].line.rowId;

  // 3. A new line; numbers are never reused, including lines whose ink is all erased.
  const used = strokes.filter((s) => s.problemId === stroke.problemId && s.rowId).map((s) => lineNumber(s.rowId!));
  const next = Math.max(0, ...used.filter(Number.isFinite).filter((n) => n < Number.MAX_SAFE_INTEGER)) + 1;
  return `${stroke.problemId}/r${next}`;
}

/**
 * Rows for the free layout, in problem order then index. Lines with live ink are numbered 1..k: the
 * main column top to bottom, then each side column (right of a divider that spans the line) top to
 * bottom. Lines whose ink is all erased keep a row (so undo can restore them) and come after; divider
 * rows come last. A row's box spans its column: from the divider on its left to the one on its right.
 */
export function lineRows(problemIds: string[], strokes: Stroke[], fullPage = false): Row[] {
  return problemIds.flatMap((problemId) => {
    const ids = dividerIds(strokes);
    const dividers = dividersOf(strokes, problemId, ids);
    const spanning = (band: Band) => dividers.filter((d) => d.bbox.y < band.bottom && bottomOf(d.bbox) > band.top);
    const column = (band: Band) => spanning(band).filter((d) => centerX(d.bbox) < band.left).length;
    const all = bands(strokes, problemId, false, ids);
    const live = new Map(bands(strokes, problemId, true, ids).map((band) => [band.rowId, band]));
    const order = (a: Band, b: Band) => column(a) - column(b) || a.top - b.top || a.n - b.n;
    const ordered = [...all.filter((b) => live.has(b.rowId)).map((b) => live.get(b.rowId)!).sort(order),
      ...all.filter((b) => !live.has(b.rowId)).sort(order)];
    const rows: Row[] = ordered.map((band, i) => {
      const xs = spanning(band).map((d) => centerX(d.bbox));
      const left = Math.max(PAGE.studentCol.x, ...xs.filter((x) => x <= band.left));
      const right = Math.min(fullPage ? PAGE.width : PAGE.studentCol.x + PAGE.studentCol.w, ...xs.filter((x) => x >= band.right));
      return { id: band.rowId, problemId, index: i + 1,
        bbox: { x: left, y: band.top - LINE.PAD, w: right - left, h: band.bottom - band.top + 2 * LINE.PAD } };
    });
    const seen = new Set(rows.map((row) => row.id));
    const dividerRows = new Map<string, Stroke[]>();
    for (const s of strokes) {
      if (s.problemId !== problemId || !s.rowId || seen.has(s.rowId) || !ids.has(s.id)) continue;
      dividerRows.set(s.rowId, [...(dividerRows.get(s.rowId) ?? []), s]);
    }
    const extra = [...dividerRows].sort(([a], [b]) => lineNumber(a) - lineNumber(b)).map(([id, members], i) => {
      const top = Math.min(...members.map((m) => m.bbox.y)), bottom = Math.max(...members.map((m) => bottomOf(m.bbox)));
      const left = Math.min(...members.map((m) => m.bbox.x)), right = Math.max(...members.map((m) => rightOf(m.bbox)));
      return { id, problemId, index: rows.length + i + 1, bbox: { x: left, y: top, w: right - left, h: bottom - top } };
    });
    return [...rows, ...extra];
  });
}

/** Rows that currently hold live ink a student would number (dividers are not lines of work). */
export function inkedRowIds(strokes: Stroke[]): Set<string> {
  const dividers = dividerIds(strokes);
  return new Set(strokes.filter((s) => isLive(s) && !dividers.has(s.id)).flatMap((s) => (s.rowId ? [s.rowId] : [])));
}

/** Free layout keeps a blank page to start and two line heights of space below the lowest ink. */
export function freeSurfaceHeight(rows: Row[]): number {
  const lowest = Math.max(PAGE.statementMinHeight, ...rows.map((row) => row.bbox.y + row.bbox.h));
  return Math.max(PAGE.statementMinHeight + 4 * PAGE.rowHeight, lowest + 2 * PAGE.rowHeight);
}
