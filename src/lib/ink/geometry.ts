import { PAGE, type BBox, type Cluster, type Row } from "../contracts";
import { WRITE } from "./constants";

/** Missing targets use all available ink in this row, then its band if empty. */
export function targetBox(clusterIds: string[], clusters: Cluster[], row: Row): BBox {
  const local = clusters.filter((cluster) => cluster.rowId === row.id);
  const ids = new Set(clusterIds);
  const selected = local.filter((cluster) => ids.has(cluster.id));
  const targets = ids.size > 0 && selected.length === ids.size ? selected : local;
  if (!targets.length) return { ...row.bbox };
  const x = Math.min(...targets.map((cluster) => cluster.bbox.x));
  const y = Math.min(...targets.map((cluster) => cluster.bbox.y));
  return { x, y,
    w: Math.max(...targets.map((cluster) => cluster.bbox.x + cluster.bbox.w)) - x,
    h: Math.max(...targets.map((cluster) => cluster.bbox.y + cluster.bbox.h)) - y };
}

export function circleFor(box: BBox): { cx: number; cy: number; rx: number; ry: number } {
  // An ellipse inscribed in box + pad misses the corners. Circumscribe the
  // padded rectangle instead: each padded corner has normalized radius 1.
  return { cx: box.x + box.w / 2, cy: box.y + box.h / 2,
    rx: Math.SQRT2 * (box.w / 2 + WRITE.circlePad),
    ry: Math.SQRT2 * (box.h / 2 + WRITE.circlePad) };
}

export function underlineFor(box: BBox): { x1: number; y1: number; x2: number; y2: number } {
  const y = box.y + box.h + WRITE.circlePad;
  return { x1: box.x, y1: y, x2: box.x + box.w, y2: y };
}

export function marginAnchor(row: Row): { x: number; y: number } {
  return { x: PAGE.albertCol.x + 6, y: row.bbox.y + row.bbox.h / 2 };
}

/** Quadratic shaft plus two head strokes, all SVG path data in logical px. */
export function arrowFor(from: { x: number; y: number }, to: BBox): { path: string; head: [string, string] } {
  const left = to.x - WRITE.circlePad, right = to.x + to.w + WRITE.circlePad;
  const top = to.y - WRITE.circlePad, bottom = to.y + to.h + WRITE.circlePad;
  let x = Math.max(left, Math.min(right, from.x));
  let y = Math.max(top, Math.min(bottom, from.y));
  if (x === from.x && y === from.y) {
    // Inside/on the box: choose the nearest side; stable ties use left first.
    const sides = [{ x: left, y }, { x: right, y }, { x, y: top }, { x, y: bottom }];
    const nearest = sides.reduce((best, point) =>
      Math.hypot(point.x - from.x, point.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? point : best);
    x = nearest.x;
    y = nearest.y;
  }
  const dx = x - from.x, dy = y - from.y;
  const length = Math.hypot(dx, dy);
  const bend = Math.min(24, length * 0.1);
  const controlX = (from.x + x) / 2 - dy / (length || 1) * bend;
  const controlY = (from.y + y) / 2 + dx / (length || 1) * bend;
  const tangent = Math.hypot(x - controlX, y - controlY);
  const ux = tangent ? (x - controlX) / tangent : 1;
  const uy = tangent ? (y - controlY) / tangent : 0;
  const head = (side: number) => `M ${x - ux * 10 - uy * side * 5} ${y - uy * 10 + ux * side * 5} L ${x} ${y}`;
  return { path: `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${x} ${y}`, head: [head(1), head(-1)] };
}
