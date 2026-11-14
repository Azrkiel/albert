import { STUCK, type BBox, type Cluster, type Stroke } from "../contracts";

function union(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function byLeftEdge(a: Stroke, b: Stroke): number {
  if (a.bbox.x !== b.bbox.x) return a.bbox.x - b.bbox.x;
  if (a.t0 !== b.t0) return a.t0 - b.t0;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Live pen strokes of one row, grouped left to right by horizontal gap (contracts.md §2). Pure. */
export function clusterRow(strokes: Stroke[], rowId: string): Cluster[] {
  const live = strokes
    .filter((stroke) => stroke.rowId === rowId && stroke.tool === "pen" && stroke.erasedAt === undefined)
    .sort(byLeftEdge);
  const clusters: Cluster[] = [];
  let current: Cluster | undefined;
  let right = -Infinity; // running max of right edges, not the last stroke's edge
  for (const stroke of live) {
    if (!current || stroke.bbox.x - right > STUCK.CLUSTER_GAP) {
      const label = clusters.length + 1;
      current = { id: `${rowId}/c${label}`, rowId, label, strokeIds: [], bbox: { ...stroke.bbox } };
      clusters.push(current);
    } else {
      current.bbox = union(current.bbox, stroke.bbox);
    }
    current.strokeIds.push(stroke.id);
    right = Math.max(right, stroke.bbox.x + stroke.bbox.w);
  }
  return clusters;
}
