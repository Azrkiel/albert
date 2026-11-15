import type { BBox, Stroke } from "../contracts";

/** Region ownership is measured along ink segments, independent of pointer sampling rate. */
export function problemForStroke(stroke: Stroke, problems: readonly { id: string; region?: { page: number; bbox: BBox } }[], fallback: string): string {
  let best = 0, owner = fallback;
  for (const problem of problems) {
    if (!problem.region || problem.region.page !== stroke.page) continue;
    const box = problem.region.bbox;
    const inside = (x: number, y: number) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
    let length = 0;
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1]!, b = stroke.points[i]!;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.ceil(distance / 4));
      for (let j = 0; j < count; j++) {
        const t = (j + .5) / count;
        if (inside(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) length += distance / count || 1;
      }
    }
    if (stroke.points.length === 1 && inside(stroke.points[0]!.x, stroke.points[0]!.y)) length = 1;
    if (length > best) { best = length; owner = problem.id; }
  }
  return owner;
}
