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
export function revealWipe(el: SVGGraphicsElement, ms: number, skip?: Skip): Promise<void> {
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
      const share = skip?.now ? 1 : Math.min(1, (now - start) / ms);
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

/** A shared "finish now" flag: set `skip.now` and every running reveal jumps to its end on its next frame. */
export type Skip = { now: boolean };

/**
 * Draws a mark's paths one after another by animating stroke-dashoffset, the time
 * shared in proportion to path length (a shaft draws before its head). `ms <= 0`
 * leaves the mark fully drawn at once. Resolves once every path is complete.
 */
export function revealStroke(group: SVGGElement, ms: number, skip?: Skip): Promise<void> {
  const paths = [...group.querySelectorAll("path")].filter((p) => p.getAttribute("d"));
  if (ms <= 0 || !paths.length) return Promise.resolve();
  const lengths = paths.map((p) => p.getTotalLength());
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  paths.forEach((p, i) => {
    p.style.strokeDasharray = `${lengths[i]}`;
    p.style.strokeDashoffset = `${lengths[i]}`;
  });
  group.setAttribute("data-ink-revealing", "");
  const finish = () => {
    for (const p of paths) { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; }
    group.removeAttribute("data-ink-revealing");
  };
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const t = skip?.now ? ms : Math.min(ms, now - start);
      let spent = 0;
      paths.forEach((p, i) => {
        const span = ms * lengths[i]! / total;
        const share = span > 0 ? Math.max(0, Math.min(1, (t - spent) / span)) : 1;
        p.style.strokeDashoffset = `${lengths[i]! * (1 - share)}`;
        spent += span;
      });
      if (t < ms) { requestAnimationFrame(frame); return; }
      finish();
      resolve();
    };
    requestAnimationFrame(frame);
  });
}
