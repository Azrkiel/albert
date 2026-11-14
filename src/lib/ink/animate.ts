import type { InkSegment } from "../contracts";
import { WRITE } from "./constants";

const NS = "http://www.w3.org/2000/svg";
let clipIds = 0;

/** Reveal time: text and citations at charsPerSec, math at mathGlyphMs per glyph path. */
export function revealMs(seg: InkSegment | { type: "citation"; text: string }, glyphs: number): number {
  if (seg.type === "break") return 0;
  if (seg.type === "math") return glyphs * WRITE.mathGlyphMs;
  return seg.text.length / WRITE.charsPerSec * 1000;
}

/**
 * Clips `el` with a rectangle whose width grows from 0 to the element's
 * width over `ms`, left to right, then removes the clip. Put `el` at its
 * place with a transform (as renderSegment's `<g>` is), so its bbox and the
 * clip share one user space. `ms <= 0` shows it at once.
 */
export function revealWipe(el: SVGGraphicsElement, ms: number): Promise<void> {
  const box = el.getBBox();
  if (ms <= 0 || box.width <= 0) return Promise.resolve();
  // A little slack so hand-font overhangs and MathJax ink outside the box are not cut.
  const slack = 4;
  const clip = document.createElementNS(NS, "clipPath");
  clip.id = `albert-wipe-${++clipIds}`;
  const rect = document.createElementNS(NS, "rect");
  rect.setAttribute("x", String(box.x - slack));
  rect.setAttribute("y", String(box.y - slack));
  rect.setAttribute("width", "0");
  rect.setAttribute("height", String(box.height + 2 * slack));
  clip.append(rect);
  el.prepend(clip);
  el.setAttribute("clip-path", `url(#${clip.id})`);
  el.setAttribute("data-ink-revealing", "");
  const full = box.width + 2 * slack;
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const share = Math.min(1, (now - start) / ms);
      rect.setAttribute("width", String(full * share));
      if (share < 1) { requestAnimationFrame(frame); return; }
      el.removeAttribute("clip-path");
      el.removeAttribute("data-ink-revealing");
      clip.remove();
      resolve();
    };
    requestAnimationFrame(frame);
  });
}
