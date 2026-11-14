import { getStroke } from "perfect-freehand";
import type { Point } from "../contracts";

/** Shared pressure-aware geometry for the surface and future snapshots. */
export function strokeOutline(points: readonly Point[], complete = true): [number, number][] {
  return getStroke(points.map(({ x, y, p }) => [x, y, p]), {
    size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0,
    simulatePressure: false, last: complete,
  });
}

export function strokePath(points: readonly Point[], complete = true): string {
  const outline = strokeOutline(points, complete);
  const first = outline[0];
  const last = outline[outline.length - 1];
  if (!first || !last) return "";
  let path = `M${(last[0] + first[0]) / 2},${(last[1] + first[1]) / 2}`;
  for (let i = 0; i < outline.length; i++) {
    const point = outline[i]!;
    const next = outline[(i + 1) % outline.length]!;
    path += `Q${point[0]},${point[1]} ${(point[0] + next[0]) / 2},${(point[1] + next[1]) / 2}`;
  }
  return `${path}Z`;
}
