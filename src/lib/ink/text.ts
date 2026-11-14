import type { InkSegment } from "../contracts";
import { WRITE } from "./constants";
import { loadHandFont, measureText, textBaseline, textNode } from "./font";
import type { Measure, LayoutItem } from "./layout";
import { loadMath, mathToSvg } from "./math";

const NS = "http://www.w3.org/2000/svg";
type Drawable = LayoutItem["seg"];

/** Loads the hand font and MathJax when the work page mounts. Resolves true once MathJax is ready. */
export async function preloadInk(): Promise<boolean> {
  const [, math] = await Promise.allSettled([loadHandFont(), loadMath()]);
  return math.status === "fulfilled";
}

/**
 * Level 0 rendering of one laid-out item: a `<g>` whose (0, 0) is the item's
 * top-left. Text and citations are hand-font `<text>`; math is MathJax paths,
 * or the LaTeX source as text if MathJax fails. `glyphs` drives reveal time;
 * `baseline` (px below the top) lets a line align math with text.
 */
export async function renderSegment(seg: Drawable, size: number): Promise<{ node: SVGGElement; w: number; h: number; baseline: number; glyphs: number }> {
  const group = document.createElementNS(NS, "g");
  group.setAttribute("data-ink-segment", seg.type);
  if (seg.type === "break") return { node: group, w: 0, h: 0, baseline: 0, glyphs: 0 };
  if (seg.type === "math") {
    const math = await mathToSvg(seg.latex, size);
    group.append(math.node);
    return { node: group, w: math.w, h: math.h, baseline: math.baseline, glyphs: math.fallback ? seg.latex.length : math.glyphPaths.length };
  }
  await loadHandFont();
  group.append(textNode(seg.text, size));
  return { node: group, ...measureText(seg.text, size), baseline: textBaseline(size), glyphs: seg.text.length };
}

/**
 * A synchronous `Measure` for layoutHint. Waits for the hand font, then
 * typesets every math segment at WRITE.fontSize up front (layout only
 * measures math at that size), so layout itself stays pure and synchronous.
 */
export async function prepareMeasure(segments: InkSegment[]): Promise<Measure> {
  await loadHandFont();
  const math = new Map<string, { w: number; h: number }>();
  for (const seg of segments) {
    if (seg.type !== "math" || math.has(seg.latex)) continue;
    const { w, h } = await mathToSvg(seg.latex, WRITE.fontSize);
    math.set(seg.latex, { w, h });
  }
  return (seg, size) => {
    if (seg.type === "break") return { w: 0, h: 0 };
    if (seg.type === "text") return measureText(seg.text, size);
    const known = size === WRITE.fontSize ? math.get(seg.latex) : undefined;
    if (!known) throw new RangeError(`Math "${seg.latex}" was not prepared at ${size}px`);
    return known;
  };
}
