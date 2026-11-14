import { LINE, type BBox, type Stroke } from "../contracts";

/** Stroke shapes shared by clustering and line inference. Pure. */

/** A fraction bar is a stroke at least this many times wider than it is tall. */
export const FRACTION_BAR_MIN_ASPECT = 3;

export const isFlat = (box: BBox) => box.w > 0 && box.w >= FRACTION_BAR_MIN_ASPECT * box.h;

/**
 * A long, near-vertical, nearly straight pen stroke that splits the page into a main column and side
 * work (P2.5b). Straightness (path length ÷ distance between its ends) keeps an integral sign out:
 * real integrals measured 1.17–1.55, a hand-drawn straight line about 1.0–1.05.
 */
export function isDivider(stroke: Stroke): boolean {
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
