import { INK, type BBox, type Cluster, type Row, type Stroke } from "../contracts";
import { strokePath } from "./path";

/**
 * Snapshots for the model (contracts.md §4.1, P2.7). `planSnapshot` is pure geometry and holds every
 * rule; `renderSnapshot` only draws the plan, so the rules are unit tested without a canvas.
 */

export const SNAPSHOT = {
  SCALE: 2,                 // device pixels per logical px
  PADDING: 24,              // logical px around everything drawn
  MAX_SIDE: 1400,           // image px; larger crops are scaled down
  LABEL_PX: 14,             // cluster numbers and row tags, logical px
  LABEL_GAP: 3,             // logical px between a cluster's top and its number
  TAG_GAP: 10,              // logical px between a row tag and the row's ink
  TAG_COLOR: "#7a7a80",     // grey row tags
  INK: "#000000",           // black ink on white
  NUDGE_STEP: 2,            // logical px per sideways nudge
  NUDGE_MAX: 160,           // logical px; beyond this a number keeps its centred place
} as const;

export type SnapshotRow = { rowId: string; index: number; clusterLabels: number[] };

export type SnapshotBackground = { page: number; url: string; width: number; height: number; region: BBox };

export type SnapshotArgs = {
  strokes: Stroke[]; rows: Row[]; clusters: Cluster[];
  problemId: string; upToRowId: string; marked: boolean; background?: SnapshotBackground;
};

export type Snapshot = { png: string; width: number; height: number; rows: SnapshotRow[] };

/** A text mark: `x` is its centre, `y` its middle, both logical px. */
export type SnapshotText = { text: string; x: number; y: number; box: BBox; clusterId?: string; rowId: string };

export type SnapshotPlan = {
  background?: SnapshotBackground;
  crop: BBox;                 // logical px, padding included
  scale: number;              // image px per logical px
  width: number; height: number;
  strokes: Stroke[];          // drawn in black, in time order
  tags: SnapshotText[];       // R1, R2, … (marked image only)
  labels: SnapshotText[];     // cluster numbers (marked image only)
  rows: SnapshotRow[];
};

const isLive = (stroke: Stroke) => stroke.tool === "pen" && stroke.erasedAt === undefined;

/** Text boxes are estimated (no DOM here): sans-serif digits and capitals are about 0.62 em wide. */
function textBox(text: string, x: number, y: number): BBox {
  const w = text.length * SNAPSHOT.LABEL_PX * 0.62;
  const h = SNAPSHOT.LABEL_PX;
  return { x: x - w / 2, y: y - h / 2, w, h };
}

function union(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const overlaps = (a: BBox, b: BBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Centre each number above its cluster. If that spot overlaps a number or tag already placed, or
 * another cluster's box, try centred below the cluster (a fraction's denominator sits right under its
 * bar), then the nearest free spot sideways above, then sideways below (right before left).
 * If nothing is free within `NUDGE_MAX`, the number keeps its centred spot above. Placement runs row
 * by row, left to right, so the result is deterministic.
 */
function placeLabels(wanted: SnapshotText[], fixed: BBox[], clusters: Cluster[]): SnapshotText[] {
  const placed: BBox[] = [...fixed];
  return wanted.map((label) => {
    const own = clusters.find((c) => c.id === label.clusterId);
    const ink = clusters.filter((c) => c !== own).map((c) => c.bbox);
    const below = own ? own.bbox.y + own.bbox.h + SNAPSHOT.LABEL_GAP + SNAPSHOT.LABEL_PX / 2 - label.y : 0;
    const free = (box: BBox) => placed.every((other) => !overlaps(box, other)) && ink.every((other) => !overlaps(box, other));
    const spots: Array<[number, number]> = [[0, 0], [0, below]];
    for (const dy of [0, below]) {
      for (let d = SNAPSHOT.NUDGE_STEP; d <= SNAPSHOT.NUDGE_MAX; d += SNAPSHOT.NUDGE_STEP) spots.push([d, dy], [-d, dy]);
    }
    for (const [dx, dy] of spots) {
      const box = { ...label.box, x: label.box.x + dx, y: label.box.y + dy };
      if (free(box)) {
        placed.push(box);
        return { ...label, x: label.x + dx, y: label.y + dy, box };
      }
    }
    placed.push(label.box);
    return label;
  });
}

/**
 * Rows 1..upTo of one problem (by `Row.index`, so lines in the free layout). Only rows with live ink
 * are drawn, tagged and listed; the stuck row itself is always listed so its id resolves. Erased and
 * eraser strokes are skipped; crossed-out ink is ordinary ink and is drawn. The crop covers the ink,
 * the tags and the numbers plus padding, and is the same whether `marked` is set or not, so a clean
 * image lines up with the marked one.
 */
export function planSnapshot(args: Omit<SnapshotArgs, "marked">): SnapshotPlan {
  const upTo = args.rows.find((row) => row.id === args.upToRowId && row.problemId === args.problemId);
  if (!upTo) throw new Error("upToRowId is not a row of this problem");
  const rows = args.rows.filter((row) => row.problemId === args.problemId && row.page === upTo.page && row.index <= upTo.index)
    .sort((a, b) => a.index - b.index);
  const rowIds = new Set(rows.map((row) => row.id));
  const strokes = args.strokes.filter((s) => s.problemId === args.problemId && isLive(s) && s.rowId !== null && rowIds.has(s.rowId))
    .sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  const clustersOf = (rowId: string) => args.clusters.filter((c) => c.rowId === rowId).sort((a, b) => a.label - b.label);

  const tags: SnapshotText[] = [];
  const wanted: SnapshotText[] = [];
  const listed: SnapshotRow[] = [];
  for (const row of rows) {
    const ink = union(strokes.filter((s) => s.rowId === row.id).map((s) => s.bbox));
    const clusters = clustersOf(row.id);
    if (ink) {
      const text = `R${row.index}`;
      const width = textBox(text, 0, 0).w;
      const x = ink.x - SNAPSHOT.TAG_GAP - width / 2;
      const y = ink.y + ink.h / 2;
      tags.push({ text, x, y, box: textBox(text, x, y), rowId: row.id });
      for (const cluster of clusters) {
        const lx = cluster.bbox.x + cluster.bbox.w / 2;
        const ly = cluster.bbox.y - SNAPSHOT.LABEL_GAP - SNAPSHOT.LABEL_PX / 2;
        const label = String(cluster.label);
        wanted.push({ text: label, x: lx, y: ly, box: textBox(label, lx, ly), clusterId: cluster.id, rowId: row.id });
      }
    }
    if (ink || row.id === upTo.id) listed.push({ rowId: row.id, index: row.index, clusterLabels: clusters.map((c) => c.label) });
  }
  const drawn = new Set(strokes.map((s) => s.rowId));
  const labels = placeLabels(wanted, tags.map((tag) => tag.box), args.clusters.filter((c) => drawn.has(c.rowId)));

  const content = union([...(args.background ? [args.background.region] : []), ...strokes.map((s) => s.bbox), ...tags.map((t) => t.box), ...labels.map((l) => l.box)])
    ?? { x: 0, y: 0, w: 0, h: 0 };
  const pad = SNAPSHOT.PADDING;
  const crop = { x: content.x - pad, y: content.y - pad, w: content.w + 2 * pad, h: content.h + 2 * pad };
  const scale = Math.min(SNAPSHOT.SCALE, SNAPSHOT.MAX_SIDE / Math.max(crop.w, crop.h));
  return {
    crop, scale, ...(args.background ? { background: args.background } : {}),
    width: Math.max(1, Math.min(SNAPSHOT.MAX_SIDE, Math.round(crop.w * scale))),
    height: Math.max(1, Math.min(SNAPSHOT.MAX_SIDE, Math.round(crop.h * scale))),
    strokes, tags, labels, rows: listed,
  };
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function draw(ctx: Context2D, plan: SnapshotPlan, marked: boolean, background?: HTMLImageElement) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.setTransform(plan.scale, 0, 0, plan.scale, -plan.crop.x * plan.scale, -plan.crop.y * plan.scale);
  if (background && plan.background) {
    ctx.globalAlpha = .35;
    ctx.drawImage(background, 0, 0, plan.background.width, plan.background.height);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = SNAPSHOT.INK;
  // Same perfect-freehand outline as the screen (path.ts), so the model sees what the student sees.
  for (const stroke of plan.strokes) ctx.fill(new Path2D(strokePath(stroke.points)));
  if (!marked) return;
  ctx.font = `600 ${SNAPSHOT.LABEL_PX}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffffff";
  // A white halo keeps a number readable where it crosses ink (a fraction bar above a denominator).
  for (const [items, color] of [[plan.tags, SNAPSHOT.TAG_COLOR], [plan.labels, INK.clusterLabel]] as const) {
    ctx.fillStyle = color;
    for (const item of items) {
      ctx.strokeText(item.text, item.x, item.y);
      ctx.fillText(item.text, item.x, item.y);
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Draws on an OffscreenCanvas, or a detached `<canvas>` where OffscreenCanvas is missing. Browser only. */
export async function renderSnapshot(args: SnapshotArgs): Promise<Snapshot> {
  const plan = planSnapshot(args);
  let background: HTMLImageElement | undefined;
  if (plan.background) {
    background = new Image();
    background.src = plan.background.url;
    await background.decode();
  }
  let png: string;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    draw(ctx, plan, args.marked, background);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    png = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    draw(ctx, plan, args.marked, background);
    png = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
  }
  return { png, width: plan.width, height: plan.height, rows: plan.rows };
}
