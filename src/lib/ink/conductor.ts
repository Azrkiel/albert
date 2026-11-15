import { PAGE, INK, type AlbertMark, type AlbertMarkSpec, type BBox, type Cluster, type HintEvent, type InkSegment, type Row } from "../contracts";
import { WRITE } from "./constants";
import { revealMs, revealStroke, revealWipe, type Skip } from "./animate";
import { measureText, textNode } from "./font";
import { circleFor, marginAnchor, targetBox } from "./geometry";
import { layoutHint, type LayoutItem } from "./layout";
import { arrowMark, circleMark, crossOutMark, hashSeed, underlineMark } from "./marks";
import { breakLongWords, mathAsText, spaceSegments, wrapLines } from "./segments";
import { prepareMeasure, renderSegment } from "./text";

/** One hint being conducted: ids, where it was asked, and the id its marks are seeded from. */
export type HintContext = { hintId: string; seedId: string; problemId: string; rowId: string; rung: number };

export type ConductorHost = {
  /** Rows and clusters as the page has them now. */
  geometry(): { rows: Row[]; clusters: Cluster[] };
  reducedMotion(): boolean;
  now(): number;
  /** A hint finished drawing: the page records a `hint_shown` session event with these marks. */
  onShown?(ctx: HintContext, marks: AlbertMark[]): void;
};

/** What the page shows around a problem's Albert layer. */
export type ProblemInk = {
  /** "More help" chip: asks for `rung` on `rowId`; `y` is the bottom of the writing, in page px. */
  chip: { rowId: string; rung: number; y: number } | null;
  /** True while any of Albert's notes are on the problem (shows "Clear Albert's notes"). */
  hasInk: boolean;
  /** Page y a surface must reach so Albert's writing and its chip fit; 0 when there is none. */
  extent: number;
};

const EMPTY: ProblemInk = { chip: null, hasInk: false, extent: 0 };
const NS = "http://www.w3.org/2000/svg";

type Drawn = { ctx: HintContext; group: SVGGElement; marks: AlbertMark[]; kinds: Set<string>; rows: Set<string>;
  writing: SVGGElement | null; faded: boolean };

/**
 * Turns one hint's `HintEvent`s into Albert's ink inside each problem's `<g class="albert">`.
 * Drawing steps run one after another on a queue, so events that arrive faster than the pen
 * still play in order. DOM-bound but free of React; the page feeds it and owns the layer elements.
 */
export function createConductor(host: ConductorHost) {
  const layers = new Map<string, SVGGElement>();
  const drawn = new Map<string, Drawn>();
  const cancelled = new Set<string>();
  const dots = new Map<string, SVGElement>();
  const skip: Skip = { now: false };
  const listeners = new Set<() => void>();
  const states = new Map<string, ProblemInk>();
  let readings: { rowId: string; latex: string; confidence: string }[] = [];
  let tail: Promise<void> = Promise.resolve();
  let pendingSteps = 0;
  let version = 0;

  const setState = (problemId: string, patch: Partial<ProblemInk>) => {
    const before = states.get(problemId) ?? EMPTY;
    const mine = [...drawn.values()].filter((d) => d.ctx.problemId === problemId);
    const writing = mine.flatMap((d) => d.marks.flatMap((m) => m.spec.type === "writing" ? [m.bbox.y + m.bbox.h] : []));
    const extent = writing.length ? Math.max(...writing) + 44 : 0;
    const next = { chip: before.chip, hasInk: mine.length > 0, extent, ...patch };
    if (next.chip === before.chip && next.hasInk === before.hasInk && next.extent === before.extent) return;
    states.set(problemId, next);
    version++;
    listeners.forEach((l) => l());
  };
  const enqueue = (ctx: HintContext, step: () => Promise<void> | void) => {
    pendingSteps++;
    tail = tail.then(async () => {
      try { if (!cancelled.has(ctx.hintId)) await step(); } catch (error) { console.error("Albert ink step failed", error); }
      if (--pendingSteps === 0) skip.now = false;
    });
  };
  const ms = (value: number) => host.reducedMotion() || skip.now ? 0 : value;
  const gone = (ctx: HintContext) => cancelled.has(ctx.hintId);

  const entry = (ctx: HintContext): Drawn | null => {
    const existing = drawn.get(ctx.hintId);
    if (existing) return existing;
    const layer = layers.get(ctx.problemId);
    if (!layer) return null;
    const group = document.createElementNS(NS, "g");
    group.setAttribute("data-albert-hint", ctx.hintId);
    group.setAttribute("data-rung", String(ctx.rung));
    group.setAttribute("data-row-id", ctx.rowId);
    layer.append(group);
    const made: Drawn = { ctx, group, marks: [], kinds: new Set(), rows: new Set([ctx.rowId]), writing: null, faded: false };
    drawn.set(ctx.hintId, made);
    setState(ctx.problemId, {});
    return made;
  };
  const fadeEl = (el: SVGElement) => {
    el.style.transition = host.reducedMotion() ? "none" : "opacity 400ms ease";
    el.style.opacity = String(WRITE.fadedOpacity);
    el.setAttribute("data-faded", "");
  };
  const remove = (hintId: string) => {
    const d = drawn.get(hintId);
    if (!d) return;
    d.group.remove();
    drawn.delete(hintId);
    setState(d.ctx.problemId, {});
  };
  const removeDot = (hintId: string) => { dots.get(hintId)?.remove(); dots.delete(hintId); };

  /** Marks other, earlier hints already drew on this row (rung 2 keeps rung 1's circle and arrow). */
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
    if (alreadyDrawn(ctx, kind, rowId) || made.kinds.has(kind)) return;
    const box = targetBox(ids, clusters, row);
    const seed = hashSeed(`${ctx.seedId}/${kind}`);
    let group: SVGGElement, duration: number;
    if (spec.type === "circle") { group = circleMark(svg, box, seed); duration = WRITE.circleMs; }
    else if (spec.type === "underline") { group = underlineMark(svg, box, seed); duration = WRITE.underlineMs; }
    else if (spec.type === "cross_out") { group = crossOutMark(svg, box, seed); duration = WRITE.crossOutMs; }
    else {
      // Point at the circle's edge when this hint (or an earlier rung) circled the same row, else at the clusters.
      const circled = made.marks.some((m) => m.spec.type === "circle" && m.spec.rowId === rowId) || alreadyDrawn(ctx, "circle", rowId);
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

  /** layoutHint, then the written fallbacks: math as LaTeX source, then over-wide words broken. Never drops the hint. */
  async function layoutWithFallback(row: Row, segments: InkSegment[], citation: string | undefined, occupied: BBox[]) {
    const attempt = async (segs: InkSegment[], cite: string | undefined) =>
      layoutHint({ row, segments: segs, ...(cite === undefined ? {} : { citation: cite }), measure: await prepareMeasure(segs), occupied });
    const column = PAGE.albertCol.w - 2 * WRITE.padX;
    try { return await attempt(segments, citation); } catch (error) { if (!(error instanceof RangeError)) throw error; }
    const plain = mathAsText(segments);
    try { return await attempt(plain, citation); } catch (error) { if (!(error instanceof RangeError)) throw error; }
    const broken = plain.map((s): InkSegment => s.type === "text" ? { ...s, text: breakLongWords(s.text, column, (t) => measureText(t, WRITE.fontSize).w) } : s);
    const cite = citation === undefined ? undefined : breakLongWords(citation, column, (t) => measureText(t, WRITE.citationSize).w);
    return attempt(broken, cite);
  }

  async function writeHint(ctx: HintContext, event: Extract<HintEvent, { type: "hint" }>) {
    const made = entry(ctx);
    const { rows } = host.geometry();
    const row = rows.find((r) => r.id === ctx.rowId);
    if (!made || !row) return;
    // An arrow always accompanies a circle, so the note points at what it is about.
    const circle = made.marks.find((m) => m.spec.type === "circle");
    if (circle && circle.spec.type === "circle" && !made.kinds.has("arrow") && !alreadyDrawn(ctx, "arrow", circle.spec.rowId)) {
      await drawMark(ctx, { type: "arrow", toRowId: circle.spec.rowId, toClusterIds: circle.spec.clusterIds });
    }
    // Earlier rungs on this row fade to a ghost; their circle and arrow stay.
    for (const other of drawn.values()) {
      if (other.ctx !== ctx && other.ctx.problemId === ctx.problemId && other.ctx.rowId === ctx.rowId && other.writing) fadeEl(other.writing);
    }
    const spaced = spaceSegments(event.segments);
    const occupied = [...drawn.values()].filter((d) => d.ctx !== ctx && d.ctx.problemId === ctx.problemId)
      .flatMap((d) => d.marks.flatMap((m) => m.spec.type === "writing" ? [m.bbox] : []));
    const laid = await layoutWithFallback(row, spaced, event.citation?.label, occupied);
    if (gone(ctx)) return;
    const rendered = await Promise.all(laid.items.map((item) =>
      renderSegment(item.seg, item.seg.type === "citation" ? WRITE.citationSize : WRITE.fontSize)));
    if (gone(ctx)) return;
    // Align each line's math and text on one baseline: shift every item down by its baseline deficit.
    const lineBase = new Map<number, number>();
    laid.items.forEach((item, i) => lineBase.set(item.line, Math.max(lineBase.get(item.line) ?? 0, rendered[i]!.baseline)));
    const writing = document.createElementNS(NS, "g");
    writing.setAttribute("data-albert-writing", "");
    writing.setAttribute("aria-hidden", "true");
    const placed = laid.items.map((item: LayoutItem, i) => {
      const y = item.y + (lineBase.get(item.line)! - rendered[i]!.baseline);
      const el = document.createElementNS(NS, "g");
      el.setAttribute("transform", `translate(${item.x} ${y})`);
      el.setAttribute("visibility", "hidden");
      el.append(rendered[i]!.node);
      writing.append(el);
      return { el, item, y, glyphs: rendered[i]!.glyphs };
    });
    made.group.append(writing);
    made.writing = writing;
    const top = Math.min(laid.bbox.y, ...placed.map((p) => p.y));
    const bottom = Math.max(laid.bbox.y + laid.bbox.h, ...placed.map((p) => p.y + p.item.h));
    const bbox: BBox = { x: laid.bbox.x, y: top, w: laid.bbox.w, h: bottom - top };
    made.marks.push({ id: `${ctx.hintId}/writing`, hintId: ctx.hintId, problemId: ctx.problemId,
      spec: { type: "writing", rowId: ctx.rowId, segments: event.segments, ...(event.citation ? { citation: event.citation.label } : {}) },
      bbox, drawnAt: host.now() });
    setState(ctx.problemId, {});
    for (const p of placed) {
      if (gone(ctx)) return;
      p.el.removeAttribute("visibility");
      await revealWipe(p.el, ms(revealMs(p.item.seg, p.glyphs)), skip);
    }
  }

  function finish(ctx: HintContext) {
    removeDot(ctx.hintId);
    const made = drawn.get(ctx.hintId);
    if (!made) { setState(ctx.problemId, {}); return; }
    const writing = made.marks.find((m) => m.spec.type === "writing");
    const row = host.geometry().rows.find((r) => r.id === ctx.rowId);
    const y = writing ? writing.bbox.y + writing.bbox.h : (row ? row.bbox.y + row.bbox.h : 0);
    setState(ctx.problemId, { chip: ctx.rung < 3 ? { rowId: ctx.rowId, rung: ctx.rung + 1, y } : null });
    host.onShown?.(ctx, made.marks);
  }

  function showDot(ctx: HintContext) {
    const layer = layers.get(ctx.problemId);
    const row = host.geometry().rows.find((r) => r.id === ctx.rowId);
    if (!layer || !row) return;
    removeDot(ctx.hintId);
    const { x, y } = marginAnchor(row);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "albert-dot");
    dot.setAttribute("data-albert-dot", ctx.hintId);
    dot.setAttribute("cx", String(x + 6)); dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "6"); dot.setAttribute("fill", INK.albert);
    layer.append(dot);
    dots.set(ctx.hintId, dot);
  }

  /** A grey margin note: the method this problem does not need yet. */
  async function note(ctx: HintContext, text: string) {
    const layer = layers.get(ctx.problemId);
    const made = entry(ctx);
    if (!layer || !made) return;
    const lines = wrapLines(text, PAGE.albertCol.w - 2 * WRITE.padX, (t) => measureText(t, 16).w);
    const el = document.createElementNS(NS, "g");
    el.setAttribute("data-albert-note", "");
    el.setAttribute("transform", `translate(${PAGE.albertCol.x + WRITE.padX} 8)`);
    lines.forEach((line, i) => {
      const t = textNode(line, 16);
      t.setAttribute("fill", "#76726b");
      t.setAttribute("y", String(i * 22 + 16));
      el.append(t);
    });
    made.group.append(el);
    await revealWipe(el, ms(text.length / WRITE.charsPerSec * 1000), skip);
  }

  return {
    /** The `<g class="albert">` of one problem; `null` when it unmounts. */
    attach(problemId: string, layer: SVGGElement | null) {
      if (layer) layers.set(problemId, layer); else layers.delete(problemId);
    },
    handle(ctx: HintContext, event: HintEvent) {
      if (event.type === "started") {
        ctx.seedId = event.hintId; // the stream's id seeds the wobble
        setState(ctx.problemId, { chip: null });
        showDot(ctx);
      } else if (event.type === "reading") readings = event.rows;
      else if (event.type === "diagnosis") {
        const method = event.deferredMethod;
        if (method) enqueue(ctx, () => note(ctx, `You'll meet ${method.name} in ${method.unitTitle}.`));
      } else if (event.type === "mark") enqueue(ctx, () => drawMark(ctx, event.mark));
      else if (event.type === "hint") enqueue(ctx, () => writeHint(ctx, event));
      else if (event.type === "done") enqueue(ctx, () => finish(ctx));
      else if (event.type === "error") {
        // No half-drawn hint survives an error: stop the queue's work on it and remove every mark.
        cancelled.add(ctx.hintId);
        removeDot(ctx.hintId);
        remove(ctx.hintId);
        setState(ctx.problemId, { chip: null });
      }
    },
    /** Rows of the latest `reading` event (P4.6's "What Albert read"). */
    latestReading: () => readings,
    /** Resolves when everything queued so far has finished drawing. */
    idle: () => tail,
    marksOf: (hintId: string): AlbertMark[] => drawn.get(hintId)?.marks ?? [],
    /** The student started writing: finish every running or queued animation at once. */
    interrupt() { if (pendingSteps > 0) skip.now = true; },
    /** The student wrote in this row: notes that point at it fade to a ghost. */
    inkAdded(problemId: string, rowId: string) {
      if (pendingSteps > 0) skip.now = true;
      for (const d of drawn.values()) if (d.ctx.problemId === problemId && d.rows.has(rowId) && !d.faded) { d.faded = true; fadeEl(d.group); }
    },
    /** Fades all of a problem's notes (a `correct` check, P3.7). */
    fadeProblem(problemId: string) {
      for (const d of drawn.values()) if (d.ctx.problemId === problemId && !d.faded) { d.faded = true; fadeEl(d.group); }
      setState(problemId, { chip: null });
    },
    /** "Clear Albert's notes": removes everything Albert drew on a problem. */
    clearProblem(problemId: string) {
      for (const d of [...drawn.values()]) if (d.ctx.problemId === problemId) { cancelled.add(d.ctx.hintId); removeDot(d.ctx.hintId); remove(d.ctx.hintId); }
      setState(problemId, { chip: null });
    },
    problemInk: (problemId: string): ProblemInk => states.get(problemId) ?? EMPTY,
    /** Bumps on every change to any problem's `ProblemInk`; for useSyncExternalStore. */
    version: () => version,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() {
      cancelled.clear();
      for (const d of drawn.values()) d.group.remove();
      for (const dot of dots.values()) dot.remove();
      dots.clear();
      drawn.clear();
      const ids = [...states.keys()];
      states.clear();
      if (ids.length) { version++; listeners.forEach((l) => l()); }
    },
  };
}

export type Conductor = ReturnType<typeof createConductor>;
