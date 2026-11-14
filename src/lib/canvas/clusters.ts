import { STUCK, type BBox, type Cluster, type Stroke } from "../contracts";
import { FRACTION_BAR_MIN_ASPECT, isDivider } from "./shapes";

export { FRACTION_BAR_MIN_ASPECT };

type Group = Stroke[];

const rightOf = (box: BBox) => box.x + box.w;
const bottomOf = (box: BBox) => box.y + box.h;
const centerX = (box: BBox) => box.x + box.w / 2;
const centerY = (box: BBox) => box.y + box.h / 2;

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(rightOf(a), rightOf(b)) - x, h: Math.max(bottomOf(a), bottomOf(b)) - y };
}

function byLeftEdge(a: Stroke, b: Stroke): number {
  if (a.bbox.x !== b.bbox.x) return a.bbox.x - b.bbox.x;
  if (a.t0 !== b.t0) return a.t0 - b.t0;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Left to right; a new group when the gap to the running-max right edge exceeds CLUSTER_GAP. */
function gapGroups(sorted: Stroke[]): Group[] {
  const groups: Group[] = [];
  let right = -Infinity;
  for (const stroke of sorted) {
    if (!groups.length || stroke.bbox.x - right > STUCK.CLUSTER_GAP) groups.push([]);
    groups.at(-1)!.push(stroke);
    right = Math.max(right, rightOf(stroke.bbox));
  }
  return groups;
}

type Fraction = { above: Stroke[]; bar: Stroke[]; below: Stroke[] };

/**
 * A flat stroke is a fraction bar when ink sits both above and below it within its x-range.
 * Strokes centred over the bar join by their vertical centre; strokes centred on the bar's own
 * band (a retraced bar) join the bar. Strokes just past either end that lie wholly on one side
 * and within CLUSTER_GAP of that side's ink (an exponent on the denominator) are absorbed too.
 */
function fractionAt(bar: Stroke, sorted: Stroke[]): Fraction | null {
  const box = bar.bbox;
  if (box.w <= 0 || box.w < FRACTION_BAR_MIN_ASPECT * box.h) return null;
  const middle = centerY(box);
  const above: Stroke[] = [];
  const below: Stroke[] = [];
  const onBar: Stroke[] = [bar];
  const outside: Stroke[] = [];
  for (const stroke of sorted) {
    if (stroke === bar) continue;
    const cx = centerX(stroke.bbox);
    if (cx < box.x || cx > rightOf(box)) { outside.push(stroke); continue; }
    const cy = centerY(stroke.bbox);
    if (cy < box.y) above.push(stroke);
    else if (cy > bottomOf(box)) below.push(stroke);
    else onBar.push(stroke);
  }
  if (!above.length || !below.length) return null;
  for (const [side, wholly] of [
    [above, (s: Stroke) => bottomOf(s.bbox) <= middle],
    [below, (s: Stroke) => s.bbox.y >= middle],
  ] as const) {
    let left = Math.min(...side.map((s) => s.bbox.x));
    let right = Math.max(...side.map((s) => rightOf(s.bbox)));
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < outside.length; i++) {
        const stroke = outside[i]!;
        if (!wholly(stroke) || stroke.bbox.x - right > STUCK.CLUSTER_GAP || left - rightOf(stroke.bbox) > STUCK.CLUSTER_GAP) continue;
        side.push(stroke);
        outside.splice(i--, 1);
        left = Math.min(left, stroke.bbox.x);
        right = Math.max(right, rightOf(stroke.bbox));
        changed = true;
      }
    }
  }
  return { above, bar: onBar, below };
}

/**
 * Groups in label order. The widest fraction bar splits out first: its numerator's groups,
 * then the bar, then its denominator's groups, so each part is a run of adjacent labels.
 * Numerator and denominator are segmented recursively (nested fractions). Everything else is
 * gap-grouped, and the fraction is placed among those groups by its left edge.
 */
function segment(strokes: Stroke[]): Group[] {
  const sorted = [...strokes].sort(byLeftEdge);
  const bars = [...sorted].sort((a, b) => b.bbox.w - a.bbox.w || byLeftEdge(a, b));
  for (const bar of bars) {
    const fraction = fractionAt(bar, sorted);
    if (!fraction) continue;
    const members = new Set([...fraction.above, ...fraction.bar, ...fraction.below]);
    const block = [...segment(fraction.above), fraction.bar.sort(byLeftEdge), ...segment(fraction.below)];
    const blockX = Math.min(...[...members].map((s) => s.bbox.x));
    const rest = segment(sorted.filter((stroke) => !members.has(stroke)));
    const at = rest.findIndex((group) => Math.min(...group.map((s) => s.bbox.x)) > blockX);
    return at < 0 ? [...rest, ...block] : [...rest.slice(0, at), ...block, ...rest.slice(at)];
  }
  return gapGroups(sorted);
}

/** Live pen strokes of one row as numbered clusters (contracts.md §2). Dividers are page structure, not symbols. Pure. */
export function clusterRow(strokes: Stroke[], rowId: string): Cluster[] {
  const live = strokes.filter((stroke) => stroke.rowId === rowId && stroke.tool === "pen" && stroke.erasedAt === undefined && !isDivider(stroke));
  return segment(live).map((group, index) => ({
    id: `${rowId}/c${index + 1}`, rowId, label: index + 1,
    strokeIds: group.map((stroke) => stroke.id),
    bbox: group.slice(1).reduce((box, stroke) => union(box, stroke.bbox), { ...group[0]!.bbox }),
  }));
}
