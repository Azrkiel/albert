import { type AlbertMark, type AlbertMarkSpec, type BBox, type Cluster, type HintEvent, type Row } from "../contracts";
import { WRITE } from "./constants";
import { revealStroke, type Skip } from "./animate";
import { circleFor, marginAnchor, targetBox } from "./geometry";
import { arrowMark, circleMark, crossOutMark, hashSeed, underlineMark } from "./marks";

/** One hint being conducted: ids, where it was asked, and the id its marks are seeded from. */
export type HintContext = { hintId: string; seedId: string; problemId: string; rowId: string; rung: number };

export type ConductorHost = {
  /** Rows and clusters as the page has them now. */
  geometry(): { rows: Row[]; clusters: Cluster[] };
  reducedMotion(): boolean;
  now(): number;
};

type Drawn = { ctx: HintContext; group: SVGGElement; marks: AlbertMark[]; kinds: Set<string>; rows: Set<string> };

/**
 * Turns one hint's `HintEvent`s into Albert's ink inside each problem's `<g class="albert">`.
 * Drawing steps run one after another on a queue, so events that arrive faster than the pen
 * still play in order. DOM-bound but free of React; the page feeds it and owns the layer elements.
 */
export function createConductor(host: ConductorHost) {
  const layers = new Map<string, SVGGElement>();
  const drawn = new Map<string, Drawn>();
  const cancelled = new Set<string>();
  const skip: Skip = { now: false };
  let tail: Promise<void> = Promise.resolve();
  let pendingSteps = 0;

  const enqueue = (ctx: HintContext, step: () => Promise<void> | void) => {
    pendingSteps++;
    tail = tail.then(async () => {
      try { if (!cancelled.has(ctx.hintId)) await step(); } catch (error) { console.error("Albert ink step failed", error); }
      if (--pendingSteps === 0) skip.now = false;
    });
  };
  const ms = (value: number) => host.reducedMotion() || skip.now ? 0 : value;

  const entry = (ctx: HintContext): Drawn | null => {
    const existing = drawn.get(ctx.hintId);
    if (existing) return existing;
    const layer = layers.get(ctx.problemId);
    if (!layer) return null;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-albert-hint", ctx.hintId);
    group.setAttribute("data-rung", String(ctx.rung));
    group.setAttribute("data-row-id", ctx.rowId);
    layer.append(group);
    const made: Drawn = { ctx, group, marks: [], kinds: new Set(), rows: new Set([ctx.rowId]) };
    drawn.set(ctx.hintId, made);
    return made;
  };

  /** Marks other hints already drew on this row (rung 2 keeps the circle and arrow from rung 1). */
  const alreadyDrawn = (ctx: HintContext, kind: string, rowId: string) =>
    [...drawn.values()].some((d) => d.ctx !== ctx && d.ctx.problemId === ctx.problemId && d.ctx.rung < ctx.rung
      && d.group.querySelector(`[data-mark-kind="${kind}"][data-target-row="${rowId}"]`));

  async function drawMark(ctx: HintContext, spec: AlbertMarkSpec) {
    const made = entry(ctx);
    const svg = made?.group.ownerSVGElement;
    const { rows, clusters } = host.geometry();
    const rowId = spec.type === "arrow" ? spec.toRowId : spec.rowId;
    const row = rows.find((r) => r.id === rowId);
    if (!made || !svg || !row) return;
    const ids = spec.type === "arrow" ? spec.toClusterIds : spec.clusterIds;
    const kind = spec.type;
    if (alreadyDrawn(ctx, kind, rowId)) return;
    const box = targetBox(ids, clusters, row);
    const seed = hashSeed(`${ctx.seedId}/${kind}`);
    let group: SVGGElement, duration: number;
    if (spec.type === "circle") { group = circleMark(svg, box, seed); duration = WRITE.circleMs; }
    else if (spec.type === "underline") { group = underlineMark(svg, box, seed); duration = WRITE.underlineMs; }
    else if (spec.type === "cross_out") { group = crossOutMark(svg, box, seed); duration = WRITE.crossOutMs; }
    else {
      // Point at the circle's edge when this hint circled the same row, else at the clusters.
      const circled = made.marks.some((m) => m.spec.type === "circle" && m.spec.rowId === rowId);
      const c = circleFor(box);
      const aim: BBox = circled ? { x: c.cx - c.rx + WRITE.circlePad, y: c.cy, w: 2 * (c.rx - WRITE.circlePad), h: 0 } : box;
      group = arrowMark(svg, marginAnchor(row), aim, seed).group;
      duration = WRITE.arrowMs;
    }
    group.setAttribute("data-target-row", rowId);
    made.group.append(group);
    made.kinds.add(kind);
    made.rows.add(rowId);
    const bb = group.getBBox();
    made.marks.push({ id: `${ctx.hintId}/${kind}${made.marks.length + 1}`, hintId: ctx.hintId, problemId: ctx.problemId, spec,
      bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height }, drawnAt: host.now() });
    await revealStroke(group, ms(duration), skip);
  }

  return {
    /** The `<g class="albert">` of one problem; `null` when it unmounts. */
    attach(problemId: string, layer: SVGGElement | null) {
      if (layer) layers.set(problemId, layer); else layers.delete(problemId);
    },
    handle(ctx: HintContext, event: HintEvent) {
      if (event.type === "started") ctx.seedId = event.hintId; // the stream's id seeds the wobble
      if (event.type === "mark") enqueue(ctx, () => drawMark(ctx, event.mark));
    },
    /** Resolves when everything queued so far has finished drawing (tests and the page await it). */
    idle: () => tail,
    marksOf: (hintId: string): AlbertMark[] => drawn.get(hintId)?.marks ?? [],
    reset() {
      cancelled.clear();
      for (const d of drawn.values()) d.group.remove();
      drawn.clear();
    },
  };
}

export type Conductor = ReturnType<typeof createConductor>;
