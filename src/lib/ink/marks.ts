import rough from "roughjs";
import { INK, type BBox } from "../contracts";
import { WRITE } from "./constants";
import { arrowFor, circleFor, underlineFor } from "./geometry";

const NS = "http://www.w3.org/2000/svg";
export type MarkKind = "circle" | "underline" | "cross_out" | "arrow";

/** FNV-1a, never 0 (roughjs treats seed 0 as "random"). The same id always gives the same wobble. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return (hash % 2147483646) + 1;
}

const base = (seed: number) => ({ stroke: INK.albert, strokeWidth: 2.5, fill: "none", seed });

/** Wraps roughjs output in one `<g class="albert-mark" data-mark-kind>`; every shape is stroke-only paths. */
function wrap(kind: MarkKind, shapes: SVGGElement[]): SVGGElement {
  const group = document.createElementNS(NS, "g");
  group.setAttribute("class", "albert-mark");
  group.setAttribute("data-mark-kind", kind);
  group.setAttribute("fill", "none");
  group.setAttribute("stroke-linecap", "round");
  group.append(...shapes);
  return group;
}

export function circleMark(svg: SVGSVGElement, box: BBox, seed: number): SVGGElement {
  const { cx, cy, rx, ry } = circleFor(box);
  return wrap("circle", [rough.svg(svg).ellipse(cx, cy, 2 * rx, 2 * ry, { ...base(seed), roughness: 1.6 })]);
}

export function underlineMark(svg: SVGSVGElement, box: BBox, seed: number): SVGGElement {
  const { x1, y1, x2, y2 } = underlineFor(box);
  return wrap("underline", [rough.svg(svg).line(x1, y1, x2, y2, { ...base(seed), roughness: 1.4, disableMultiStroke: false })]);
}

export function crossOutMark(svg: SVGSVGElement, box: BBox, seed: number): SVGGElement {
  const pad = WRITE.circlePad / 2;
  return wrap("cross_out", [rough.svg(svg).line(box.x - pad, box.y + box.h + pad, box.x + box.w + pad, box.y - pad,
    { ...base(seed), roughness: 1.2 })]);
}

/** Shaft first, then the two head strokes, so the shaft draws before its head. */
export function arrowMark(svg: SVGSVGElement, from: { x: number; y: number }, to: BBox, seed: number): { group: SVGGElement; shaft: string } {
  const { path, head } = arrowFor(from, to);
  const rc = rough.svg(svg);
  const shaft = rc.path(path, { ...base(seed), roughness: 0.9 });
  const heads = head.map((d, i) => rc.path(d, { ...base(seed + i + 1), roughness: 0.6, strokeWidth: 2.5 }));
  return { group: wrap("arrow", [shaft, ...heads]), shaft: path };
}
