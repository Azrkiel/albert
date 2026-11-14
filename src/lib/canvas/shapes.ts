import { LINE, type BBox, type Stroke } from "../contracts";

/** Stroke shapes shared by clustering and line inference. Pure. */

/** A fraction bar is a stroke at least this many times wider than it is tall. */
export const FRACTION_BAR_MIN_ASPECT = 3;

export const isFlat = (box: BBox) => box.w > 0 && box.w >= FRACTION_BAR_MIN_ASPECT * box.h;

/** Thin, nearly straight and at least the absolute minimum height: a divider candidate. */
function dividerShape(stroke: Stroke): boolean {
  const { w, h } = stroke.bbox;
  if (stroke.tool !== "pen" || h < LINE.DIVIDER_MIN_HEIGHT || w > LINE.DIVIDER_MAX_WIDTH_RATIO * h) return false;
  let length = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!, b = stroke.points[i]!;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = stroke.points[0], last = stroke.points.at(-1);
  const chord = first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
  return chord > 0 && length <= LINE.DIVIDER_MAX_PATH_RATIO * chord;
}

/** Strokes tall enough to count toward the writing's letter size (not dots, not bars or minus signs). */
const isGlyph = (stroke: Stroke) => stroke.tool === "pen" && stroke.bbox.h >= 8 && !isFlat(stroke.bbox);

/**
 * Ids of divider strokes (P2.5b): long, near-vertical, nearly straight pen strokes that split the page
 * into a main column and side work. "Long" is at least LINE.DIVIDER_MIN_HEIGHT and at least
 * LINE.DIVIDER_MIN_GLYPHS × the median height of the letters written earlier in the same problem, so a
 * "1" or an absolute-value bar never counts. Only earlier strokes (erased or not) set the baseline, so a
 * stroke's status never changes as more is written. Straightness (path ÷ end-to-end distance) keeps an
 * integral sign out: real integrals measured 1.17–1.55, hand-drawn straight lines 1.0–1.05.
 */
export function dividerIds(strokes: Stroke[]): Set<string> {
  const ids = new Set<string>();
  const byProblem = new Map<string, Stroke[]>();
  for (const s of strokes) if (s.tool === "pen") byProblem.set(s.problemId, [...(byProblem.get(s.problemId) ?? []), s]);
  for (const list of byProblem.values()) {
    const heights: number[] = []; // sorted
    for (const s of [...list].sort((a, b) => a.t0 - b.t0 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (dividerShape(s)) {
        const median = heights.length ? heights[Math.floor(heights.length / 2)]! : 0;
        if (s.bbox.h >= LINE.DIVIDER_MIN_GLYPHS * median) { ids.add(s.id); continue; }
      }
      if (!isGlyph(s)) continue;
      const at = heights.findIndex((h) => h > s.bbox.h);
      heights.splice(at < 0 ? heights.length : at, 0, s.bbox.h);
    }
  }
  return ids;
}

/** Whether one stroke is a divider, given the strokes around it (defaults to none). */
export function isDivider(stroke: Stroke, context: Stroke[] = []): boolean {
  return dividerIds([...context.filter((s) => s.id !== stroke.id), stroke]).has(stroke.id);
}
