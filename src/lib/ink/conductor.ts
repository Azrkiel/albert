import { pdfNoteBand } from "../canvas/pdf-pages";
import { PAGE, INK, type AlbertMark, type AlbertMarkSpec, type BBox, type Cluster, type HintEvent, type InkSegment, type Row } from "../contracts";
import { POINTER_MS, liveMarkTarget, placePenTip, movePenTip, pointerSteps, runMarkSteps, targetCentre, type PenPosition } from "./pointer";
import { WRITE } from "./constants";
import { revealMs, revealStroke, revealWipe, type Skip } from "./animate";
import { measureText, textNode } from "./font";
import { circleFor, marginAnchor } from "./geometry";
import { layoutHint, type LayoutItem } from "./layout";
import { arrowMark, circleMark, crossOutMark, hashSeed, underlineMark } from "./marks";
import { breakLongWords, mathAsText, spaceSegments, wrapLines } from "./segments";
import { prepareMeasure, renderSegment } from "./text";

/** Room a PDF note needs under the work (label, two lines, citation, More help) before it falls back below the page. */
const PDF_NOTE_ROOM = 190;
/** Width of a PDF note's column: wide enough for a short question, narrow enough to sit beside print. */
const PDF_NOTE_WIDTH = 600;

/** One hint being conducted: ids, where it was asked, and the id its marks are seeded from. */
export type HintContext = { hintId: string; seedId: string; problemId: string; rowId: string; rung: number;
  /** Set when a recording is replaying this hint's `hint_shown`: "instant" draws the final state at once. */
  replay?: "instant" | "animate";
  /** Set when the hint starts: the screen is under 900 px, so the writing goes in a band under the rows. */
  narrow?: boolean };

export type ConductorHost = {
  /** PDF notes use labelled below-page bands without arrows across printed content. */
  pageMode?(): boolean;
  noteLabel?(problemId: string): string | undefined;
  /** Rows and clusters as the page has them now. */
  geometry(): { rows: Row[]; clusters: Cluster[] };
  reducedMotion(): boolean;
  /** Under 900 CSS px: Albert's column moves into a full-width band under the rows (P4.6). */
  narrow?(): boolean;
  pageHeight?(page: number): number;
  /** Optional placement override for a page-backed host. */
  bandTop?(problemId: string, rowId?: string): number;
  now(): number;
  /** A hint finished drawing: the page records a `hint_shown` session event with these marks. */
  onShown?(ctx: HintContext, marks: AlbertMark[]): void;
};

/** What the page shows around a problem's Albert layer. */
export type ProblemInk = {
  /** "More help" chip: asks for `rung` on `rowId`; `y` is the bottom of the writing, in page px. */
  chip: { rowId: string; rung: number; x: number; y: number } | null;
  /** True while any of Albert's notes are on the problem (shows "Clear Albert's notes"). */
  hasInk: boolean;
  /** Page y a surface must reach so Albert's writing and its chip fit; 0 when there is none. */
  extent: number;
};

const EMPTY: ProblemInk = { chip: null, hasInk: false, extent: 0 };
const NS = "http://www.w3.org/2000/svg";

type Drawn = { ctx: HintContext; group: SVGGElement; marks: AlbertMark[]; kinds: Set<string>; rows: Set<string>;
  writing: SVGGElement | null; faded: boolean; motion: Skip };

/**
 * Turns one hint's `HintEvent`s into Albert's ink inside each problem's `<g class="albert">`.
 * Drawing steps run one after another on a queue, so events that arrive faster than the pen
 * still play in order. DOM-bound but free of React; the page feeds it and owns the layer elements.
 */
export function createConductor(host: ConductorHost) {
  const layers = new Map<string, SVGGElement>();
  // A layer that unmounted keeps receiving ink until its replacement attaches, then hands its notes over.
  const orphans = new Map<string, SVGGElement>();
  const layerKey = (problemId: string, page?: number) => page === undefined ? problemId : `${problemId}/page${page}`;
  const layerOf = (problemId: string, rowId?: string) => {
    const page = host.geometry().rows.find(r => r.id === rowId)?.page;
    const key = layerKey(problemId, page);
    return layers.get(key) ?? orphans.get(key);
  };
  const drawn = new Map<string, Drawn>();
  const cancelled = new Set<string>();
  const pendingReplays = new Map<string, { marks: AlbertMark[]; opts: { instant: boolean; rung: number } }>();
  const dots = new Map<string, SVGElement>();
  const pointers = new Map<string, SVGGElement>();
  let pointerPositions = new WeakMap<SVGSVGElement, PenPosition>();
  const skip: Skip = { now: false };
  const animationSkip = (made: Drawn): Skip => ({ get now() { return skip.now || made.motion.now; } });
  const listeners = new Set<() => void>();
  const states = new Map<string, ProblemInk>();
  let readings: { rowId: string; latex: string; confidence: string }[] = [];
  let tail: Promise<void> = Promise.resolve();
  let pendingSteps = 0;
  let generation = 0;
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
    const scheduledGeneration = generation;
    tail = tail.then(async () => {
      try { if (scheduledGeneration === generation && !cancelled.has(ctx.hintId)) await step(); } catch (error) { console.error("Albert ink step failed", error); }
      if (--pendingSteps === 0) skip.now = false;
    });
  };
  const ms = (value: number, ctx?: HintContext) => host.reducedMotion() || skip.now || ctx?.replay === "instant" ? 0 : value;
  const gone = (ctx: HintContext) => cancelled.has(ctx.hintId);

  const entry = (ctx: HintContext): Drawn | null => {
    const existing = drawn.get(ctx.hintId);
    if (existing) return existing;
    const layer = layerOf(ctx.problemId, ctx.rowId);
    if (!layer) return null;
    ctx.narrow ??= host.geometry().rows.find(r => r.id === ctx.rowId)?.page !== undefined || (host.narrow?.() ?? false);
    const group = document.createElementNS(NS, "g");
    group.setAttribute("data-albert-hint", ctx.hintId);
    group.setAttribute("data-rung", String(ctx.rung));
    group.setAttribute("data-row-id", ctx.rowId);
    layer.append(group);
    const made: Drawn = { ctx, group, marks: [], kinds: new Set(), rows: new Set([ctx.rowId]), writing: null, faded: false, motion: { now: false } };
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
    d.motion.now = true;
    d.group.remove();
    drawn.delete(hintId);
    setState(d.ctx.problemId, {});
  };
  const removeDot = (hintId: string) => { dots.get(hintId)?.remove(); dots.delete(hintId); };
  const removePointer = (hintId: string) => { pointers.get(hintId)?.remove(); pointers.delete(hintId); };

  /** Marks other, earlier hints already drew on this row (rung 2 keeps rung 1's circle and arrow). */
  const alreadyDrawn = (ctx: HintContext, kind: string, rowId: string) =>
    [...drawn.values()].some((d) => d.ctx !== ctx && d.ctx.problemId === ctx.problemId && d.ctx.rung < ctx.rung
      && d.group.querySelector(`[data-mark-kind="${kind}"][data-target-row="${rowId}"]`));

  async function drawMark(ctx: HintContext, spec: AlbertMarkSpec) {
    const made = entry(ctx);
    const svg = made?.group.ownerSVGElement;
    const rowId = spec.type === "arrow" ? spec.toRowId : spec.rowId;
    const ids = spec.type === "arrow" ? spec.toClusterIds : spec.clusterIds;
    const resolveTarget = () => {
      const { rows, clusters } = host.geometry();
      return liveMarkTarget(rows, clusters, ctx.problemId, ctx.rowId, rowId, ids);
    };
    const target = resolveTarget();
    if (!made || !svg || !target) return;
    const { row, box } = target;
    if (spec.type === "arrow" && (host.pageMode?.() ?? row.page !== undefined)) return;
    const kind = spec.type;
    if (alreadyDrawn(ctx, kind, rowId) || made.kinds.has(kind)) return;
    const drawingGeneration = generation;
    const first = made.kinds.size === 0;
    if (first) removeDot(ctx.hintId);
    try {
      await runMarkSteps(pointerSteps(first, ms(POINTER_MS, ctx) === 0), {
        pointer: async () => {
          const pointer = document.createElementNS(NS, "g");
          pointer.setAttribute("data-albert-pointer", ctx.hintId);
          pointer.setAttribute("pointer-events", "none");
          const tip = document.createElementNS(NS, "path");
          tip.setAttribute("d", "M 0 0 L -4 -12 L 4 -12 Z"); tip.setAttribute("fill", INK.albert);
          pointer.append(tip); made.group.append(pointer); pointers.set(ctx.hintId, pointer);
          await movePenTip(pointer, pointerPositions.get(svg) ?? marginAnchor(row), targetCentre(box), {
            cancelled: () => gone(ctx) || drawingGeneration !== generation,
            target: () => { const live = resolveTarget(); return live ? targetCentre(live.box) : null; }, skip: () => skip.now || host.reducedMotion(),
            onPosition: position => pointerPositions.set(svg, position),
          });
        },
        mark: async () => {
          if (gone(ctx) || drawingGeneration !== generation) return;
          const live = resolveTarget();
          if (!live) return;
          const { row, box } = live;
          const pointer = pointers.get(ctx.hintId);
          if (pointer) { placePenTip(pointer, targetCentre(box)); pointerPositions.set(svg, targetCentre(box)); }
          const seed = hashSeed(`${ctx.seedId}/${kind}`);
          let group: SVGGElement, duration: number;
          if (spec.type === "circle") { group = circleMark(svg, box, seed); duration = WRITE.circleMs; }
          else if (spec.type === "underline") { group = underlineMark(svg, box, seed); duration = WRITE.underlineMs; }
          else if (spec.type === "cross_out") { group = crossOutMark(svg, box, seed); duration = WRITE.crossOutMs; }
          else {
            // Point at the circle's edge when this hint (or an earlier rung) circled the same row, else at the clusters.
            const circled = made.marks.some((m) => m.spec.type === "circle" && m.spec.rowId === rowId) || alreadyDrawn(ctx, "circle", rowId);
            const c = circleFor(box);
            let from = marginAnchor(row);
            let aim: BBox = box;
            if (ctx.narrow) {
              // Narrow: the arrow rises from the band under the rows to the bottom of the circle (or the clusters).
              from = { x: box.x + box.w / 2, y: bandTop(ctx) };
              aim = circled ? { x: c.cx - c.rx + WRITE.circlePad, y: c.cy - c.ry + WRITE.circlePad, w: 2 * (c.rx - WRITE.circlePad), h: 2 * (c.ry - WRITE.circlePad) } : box;
            } else if (circled) aim = { x: c.cx - c.rx + WRITE.circlePad, y: c.cy, w: 2 * (c.rx - WRITE.circlePad), h: 0 };
            group = arrowMark(svg, from, aim, seed).group;
            duration = WRITE.arrowMs;
          }
          group.setAttribute("data-target-row", rowId);
          made.group.append(group);
          made.kinds.add(kind);
          made.rows.add(rowId);
          const bb = group.getBBox();
          made.marks.push({ id: `${ctx.hintId}/${kind}${made.marks.length + 1}`, hintId: ctx.hintId, problemId: ctx.problemId, spec,
            bbox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height }, drawnAt: host.now() });
          await revealStroke(group, ms(duration, ctx), animationSkip(made));
        },
      });
    } finally { removePointer(ctx.hintId); }
  }

  /** Page y under the problem's last row, where the narrow band starts. */
  const bandTop = (ctx: HintContext) => {
    const override = host.bandTop?.(ctx.problemId, ctx.rowId);
    if (override !== undefined) return override;
    const rows = host.geometry().rows;
    const asked = rows.find(r => r.id === ctx.rowId);
    const page = asked?.page;
    if (page === undefined) return Math.max(0, ...rows.filter(r => r.problemId === ctx.problemId).map(r => r.bbox.y + r.bbox.h)) + 8;
    // PDF: write right under the student's last line of this problem on this page, so the note sits beside the work.
    // Fall back to the band below the page only when the page has no room left under the work.
    const height = host.pageHeight?.(page) ?? 0;
    const work = rows.filter(r => r.problemId === ctx.problemId && r.page === page);
    const below = Math.max(asked!.bbox.y + asked!.bbox.h, ...work.map(r => r.bbox.y + r.bbox.h)) + 14;
    return below + PDF_NOTE_ROOM <= height ? below : pdfNoteBand(height);
  };
  const columnOf = (ctx: HintContext) => {
    const { rows, clusters } = host.geometry();
    if (rows.find(r => r.id === ctx.rowId)?.page !== undefined) {
      // PDF: line the note up under the student's ink on the asked row, kept on the page.
      const ink = clusters.filter(c => c.rowId === ctx.rowId).map(c => c.bbox.x);
      const left = ink.length ? Math.min(...ink) : 0;
      return { x: Math.max(0, Math.min(left - 20, PAGE.width - PDF_NOTE_WIDTH)), w: PDF_NOTE_WIDTH };
    }
    return ctx.narrow ? { x: 0, w: PAGE.width } : PAGE.albertCol;
  };

  /** layoutHint, then the written fallbacks: math as LaTeX source, then over-wide words broken. Never drops the hint. */
  async function layoutWithFallback(row: Row, segments: InkSegment[], citation: string | undefined, occupied: BBox[], col: { x: number; w: number }) {
    const attempt = async (segs: InkSegment[], cite: string | undefined) =>
      layoutHint({ row, segments: segs, ...(cite === undefined ? {} : { citation: cite }), measure: await prepareMeasure(segs), occupied, column: col });
    const column = col.w - 2 * WRITE.padX;
    try { return await attempt(segments, citation); } catch (error) { if (!(error instanceof RangeError)) throw error; }
    const plain = mathAsText(segments);
    try { return await attempt(plain, citation); } catch (error) { if (!(error instanceof RangeError)) throw error; }
    const broken = plain.map((s): InkSegment => s.type === "text" ? { ...s, text: breakLongWords(s.text, column, (t) => measureText(t, WRITE.fontSize).w) } : s);
    const cite = citation === undefined ? undefined : breakLongWords(citation, column, (t) => measureText(t, WRITE.citationSize).w);
    return attempt(broken, cite);
  }

  async function writeHint(ctx: HintContext, segments: InkSegment[], citationLabel: string | undefined) {
    const made = entry(ctx);
    const { rows } = host.geometry();
    const asked = rows.find((r) => r.id === ctx.rowId);
    if (!made || !asked) return;
    // Narrow screens write in a full-width band under the problem's last row.
    const row: Row = ctx.narrow ? { ...asked, bbox: { x: 0, y: bandTop(ctx), w: PAGE.width, h: WRITE.lineHeight } } : asked;
    // An arrow always accompanies a circle, so the note points at what it is about.
    const circle = made.marks.find((m) => m.spec.type === "circle");
    if (circle && circle.spec.type === "circle" && !made.kinds.has("arrow") && !alreadyDrawn(ctx, "arrow", circle.spec.rowId)) {
      await drawMark(ctx, { type: "arrow", toRowId: circle.spec.rowId, toClusterIds: circle.spec.clusterIds });
    }
    // Earlier rungs on this row fade to a ghost; their circle and arrow stay.
    for (const other of drawn.values()) {
      if (other.ctx !== ctx && other.ctx.problemId === ctx.problemId && other.ctx.rowId === ctx.rowId && other.writing) fadeEl(other.writing);
    }
    const label = (host.pageMode?.() ?? asked.page !== undefined) ? host.noteLabel?.(ctx.problemId) : undefined;
    const displayed: InkSegment[] = label ? [{ type: "text", text: `${label}:` }, { type: "break" }, ...segments] : segments;
    const spaced = spaceSegments(displayed);
    const occupied = [...drawn.values()].filter((d) => d.ctx !== ctx && (asked.page === undefined ? d.ctx.problemId === ctx.problemId
      : rows.find(r => r.id === d.ctx.rowId)?.page === asked.page))
      .flatMap((d) => d.marks.flatMap((m) => m.spec.type === "writing" ? [m.bbox] : []));
    const laid = await layoutWithFallback(row, spaced, citationLabel, occupied, columnOf(ctx));
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
    // On a PDF page the note may sit over print: a soft paper backing (sized below) keeps Albert's ink readable.
    const backing = asked.page !== undefined ? document.createElementNS(NS, "rect") : undefined;
    if (backing) writing.append(backing);
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
    if (backing) {
      backing.setAttribute("data-albert-backing", "");
      backing.setAttribute("x", String(bbox.x - 10)); backing.setAttribute("y", String(bbox.y - 8));
      backing.setAttribute("width", String(bbox.w + 20)); backing.setAttribute("height", String(bbox.h + 16));
      backing.setAttribute("rx", "10"); backing.setAttribute("fill", "#fffdf7"); backing.setAttribute("fill-opacity", "0.94");
      backing.setAttribute("stroke", INK.albert); backing.setAttribute("stroke-opacity", "0.25");
    }
    made.marks.push({ id: `${ctx.hintId}/writing`, hintId: ctx.hintId, problemId: ctx.problemId,
      spec: { type: "writing", rowId: ctx.rowId, segments, ...(citationLabel === undefined ? {} : { citation: citationLabel }) },
      bbox, drawnAt: host.now() });
    setState(ctx.problemId, {});
    for (const p of placed) {
      if (gone(ctx)) return;
      p.el.removeAttribute("visibility");
      await revealWipe(p.el, ms(revealMs(p.item.seg, p.glyphs), ctx), animationSkip(made));
    }
  }

  function finish(ctx: HintContext) {
    removeDot(ctx.hintId);
    const made = drawn.get(ctx.hintId);
    if (!made || ctx.replay) { setState(ctx.problemId, {}); return; } // a replayed hint has no chip and is not recorded again
    const writing = made.marks.find((m) => m.spec.type === "writing");
    const row = host.geometry().rows.find((r) => r.id === ctx.rowId);
    const y = writing ? writing.bbox.y + writing.bbox.h : (row ? row.bbox.y + row.bbox.h : 0);
    const chipX = row?.page !== undefined && writing ? writing.bbox.x : ctx.narrow ? WRITE.padX : PAGE.albertCol.x + WRITE.padX;
    setState(ctx.problemId, { chip: ctx.rung < 3 ? { rowId: ctx.rowId, rung: ctx.rung + 1, x: chipX, y } : null });
    host.onShown?.(ctx, made.marks);
  }

  function showDot(ctx: HintContext) {
    const layer = layerOf(ctx.problemId, ctx.rowId);
    const row = host.geometry().rows.find((r) => r.id === ctx.rowId);
    if (!layer || !row) return;
    ctx.narrow ??= host.geometry().rows.find(r => r.id === ctx.rowId)?.page !== undefined || (host.narrow?.() ?? false);
    removeDot(ctx.hintId);
    const { x, y } = ctx.narrow ? { x: WRITE.padX, y: bandTop(ctx) + WRITE.lineHeight / 2 } : marginAnchor(row);
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
    const layer = layerOf(ctx.problemId, ctx.rowId);
    const made = entry(ctx);
    if (!layer || !made) return;
    const lines = wrapLines(text, PAGE.albertCol.w - 2 * WRITE.padX, (t) => measureText(t, 16).w);
    const el = document.createElementNS(NS, "g");
    el.setAttribute("data-albert-note", "");
    el.setAttribute("transform", `translate(${ctx.narrow ? WRITE.padX : PAGE.albertCol.x + WRITE.padX} ${host.geometry().rows.find(r => r.id === ctx.rowId)?.page === undefined ? 8 : bandTop(ctx)})`);
    lines.forEach((line, i) => {
      const t = textNode(line, 16);
      t.setAttribute("fill", "#76726b");
      t.setAttribute("y", String(i * 22 + 16));
      el.append(t);
    });
    made.group.append(el);
    await revealWipe(el, ms(text.length / WRITE.charsPerSec * 1000, ctx), animationSkip(made));
  }

  function replayShown(marks: AlbertMark[], opts: { instant: boolean; rung: number }) {
    const first = marks[0];
    if (!first || drawn.has(first.hintId)) return;
    const writing = marks.find((m) => m.spec.type === "writing");
    const spec = (writing ?? first).spec;
    const rowId = spec.type === "arrow" ? spec.toRowId : spec.rowId;
    const ctx: HintContext = { hintId: first.hintId, seedId: first.hintId, problemId: first.problemId, rowId, rung: opts.rung,
      replay: opts.instant ? "instant" : "animate" };
    if (!layerOf(first.problemId, rowId)) {
      pendingReplays.set(first.hintId, { marks, opts });
      return;
    }
    pendingReplays.delete(first.hintId);
    for (const mark of marks) {
      const s = mark.spec;
      if (s.type === "writing") enqueue(ctx, () => writeHint(ctx, s.segments, s.citation));
      else enqueue(ctx, () => drawMark(ctx, s));
    }
    enqueue(ctx, () => finish(ctx));
  }

  return {
    /** The `<g class="albert">` of one problem; `null` when it unmounts. */
    attach(problemId: string, layer: SVGGElement | null, page?: number) {
      problemId = layerKey(problemId, page);
      const old = layers.get(problemId) ?? orphans.get(problemId);
      if (layer) {
        layers.set(problemId, layer);
        orphans.delete(problemId);
        if (old && old !== layer) layer.append(...old.childNodes); // A replay recreated the surface.
        for (const pending of [...pendingReplays.values()]) replayShown(pending.marks, pending.opts);
      } else {
        const detached = layers.get(problemId);
        layers.delete(problemId);
        if (detached) orphans.set(problemId, detached);
      }
    },
    handle(ctx: HintContext, event: HintEvent) {
      if (event.type === "started") {
        ctx.seedId = event.hintId; // the stream's id seeds the wobble
        setState(ctx.problemId, { chip: null });
        showDot(ctx);
      } else if (event.type === "reading") { readings = event.rows; version++; listeners.forEach((l) => l()); }
      else if (event.type === "diagnosis") {
        const method = event.deferredMethod;
        // PDF pages have no margin column for this aside; it would overlap the hint note, so it is not drawn there.
        const onPdf = host.geometry().rows.find(r => r.id === ctx.rowId)?.page !== undefined;
        if (method && !onPdf) {
          // Unit titles often repeat the method name ("Partial fractions in Partial Fractions"): say "later" instead.
          const same = method.unitTitle.trim().toLowerCase() === method.name.trim().toLowerCase();
          const text = same ? `You'll meet ${method.name} later in the course.` : `You'll meet ${method.name} in ${method.unitTitle}.`;
          enqueue(ctx, () => note(ctx, text));
        }
      } else if (event.type === "mark") enqueue(ctx, () => drawMark(ctx, event.mark));
      else if (event.type === "hint") enqueue(ctx, () => writeHint(ctx, event.segments, event.citation?.label));
      else if (event.type === "done") enqueue(ctx, () => finish(ctx));
      else if (event.type === "error") {
        // No half-drawn hint survives an error: stop the queue's work on it and remove every mark.
        cancelled.add(ctx.hintId);
        removeDot(ctx.hintId);
        removePointer(ctx.hintId);
        remove(ctx.hintId);
        setState(ctx.problemId, { chip: null });
        // The partial reading goes too, so no typeset math of a failed hint stays in the row tooltips.
        if (readings.length) { readings = []; version++; listeners.forEach((l) => l()); }
      }
    },
    /**
     * A recording's `hint_shown` event: redraw its marks. `instant` (seek / instant speed) draws the final state at
     * once; otherwise they animate. Live hints are already on the page, so they are skipped. Marks are seeded from
     * the recorded hint id, so a replay's wobble can differ from the live one.
     */
    replayShown,
    cancel(hintId: string) {
      cancelled.add(hintId);
      pendingReplays.delete(hintId);
      removeDot(hintId); removePointer(hintId);
      const problemId = drawn.get(hintId)?.ctx.problemId;
      remove(hintId);
      if (problemId) setState(problemId, { chip: null });
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
      for (const d of [...drawn.values()]) if (d.ctx.problemId === problemId) { cancelled.add(d.ctx.hintId); removeDot(d.ctx.hintId); removePointer(d.ctx.hintId); remove(d.ctx.hintId); }
      setState(problemId, { chip: null });
    },
    pageExtent: (page: number) => Math.max(0, ...[...drawn.values()]
      .filter(d => host.geometry().rows.find(r => r.id === d.ctx.rowId)?.page === page)
      .flatMap(d => d.marks.filter(m => m.spec.type === "writing").map(m => m.bbox.y + m.bbox.h + 44))),
    problemInk: (problemId: string): ProblemInk => states.get(problemId) ?? EMPTY,
    /** Bumps on every change to any problem's `ProblemInk`; for useSyncExternalStore. */
    version: () => version,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() {
      generation++;
      cancelled.clear();
      pendingReplays.clear();
      readings = [];
      for (const d of drawn.values()) { d.motion.now = true; d.group.remove(); }
      skip.now = false;
      for (const dot of dots.values()) dot.remove();
      dots.clear();
      for (const pointer of pointers.values()) pointer.remove();
      pointers.clear();
      pointerPositions = new WeakMap();
      drawn.clear();
      const ids = [...states.keys()];
      states.clear();
      if (ids.length) { version++; listeners.forEach((l) => l()); }
    },
  };
}

export type Conductor = ReturnType<typeof createConductor>;
