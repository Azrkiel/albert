import { INK } from "../contracts";
import { loadHandFont, measureText, textBaseline, textNode } from "./font";

export type MathSvg = {
  node: SVGSVGElement; w: number; h: number; glyphPaths: SVGPathElement[];
  /** Distance from the top to the math baseline, so a line can align math with text (P4.4). */
  baseline: number;
  /** True when MathJax could not typeset the formula and the LaTeX source is shown as hand text. */
  fallback: boolean;
};
type Engine = (latex: string) => Promise<Element>;

const NS = "http://www.w3.org/2000/svg";
let engine: Promise<Engine> | null = null;

/**
 * Loads MathJax once: TeX input (base + ams) and SVG output with
 * `fontCache: "none"`, so every glyph is an inline path. Imported on demand
 * so the work page renders before the ~1 MB typesetter arrives. A failed
 * load can be retried by calling again.
 */
export function loadMath(): Promise<Engine> {
  engine ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { browserAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("@mathjax/src/js/mathjax.js"),
      import("@mathjax/src/js/input/tex.js"),
      import("@mathjax/src/js/output/svg.js"),
      import("@mathjax/src/js/adaptors/browserAdaptor.js"),
      import("@mathjax/src/js/handlers/html.js"),
      import("@mathjax/src/js/input/tex/base/BaseConfiguration.js"),
      import("@mathjax/src/js/input/tex/ams/AmsConfiguration.js"),
    ]);
    RegisterHTMLHandler(browserAdaptor());
    // Throw on TeX errors instead of drawing MathJax's red error box; mathToSvg falls back to text.
    const tex = new TeX({ packages: ["base", "ams"], formatError: (_jax: unknown, error: unknown) => { throw error; } });
    // v4 breaks long inline math into several <svg>s by default; a hint formula must stay one piece.
    const doc = mathjax.document(document, { InputJax: tex, OutputJax: new SVG({ fontCache: "none", linebreaks: { inline: false } }) });
    return async (latex: string) => {
      const out: unknown = await doc.convertPromise(latex, { display: false });
      if (!(out instanceof Element)) throw new Error("MathJax returned no element");
      return out;
    };
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

/** SVG units per em in MathJax's viewBox. */
const UNITS_PER_EM = 1000;
const cache = new Map<string, Promise<MathSvg>>();

/**
 * Typesets `latex` at `sizePx` (1 em) as a nestable `<svg>` with explicit
 * width/height/x/y, coloured INK.albert. Cached by latex + size; each call
 * returns a fresh copy so the same formula can be drawn twice. Never
 * rejects: if MathJax fails, the LaTeX source comes back as hand text.
 */
export function mathToSvg(latex: string, sizePx: number): Promise<MathSvg> {
  const key = `${sizePx}\u0000${latex}`;
  let template = cache.get(key);
  if (!template) {
    template = typeset(latex, sizePx).catch(() => fallback(latex, sizePx));
    cache.set(key, template);
  }
  return template.then(copy);
}

async function typeset(latex: string, sizePx: number): Promise<MathSvg> {
  const out = await (await loadMath())(latex);
  const parts = out.querySelectorAll("svg");
  const svg = parts.length === 1 ? parts[0] : undefined;
  const box = svg?.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!svg || !box || box.length !== 4 || !box.every(Number.isFinite)) throw new Error("MathJax output is not one SVG with a viewBox");
  if (svg.querySelector("[data-mjx-error], [data-mml-node=merror]")) throw new Error("MathJax reported an error");
  // Invisible operators (e.g. U+2061 after \cos) come out as empty paths; they are not glyphs.
  for (const path of svg.querySelectorAll("path")) if (!path.getAttribute("d")) path.remove();
  if (!svg.querySelector("path")) throw new Error("MathJax drew no glyphs");
  const w = box[2]! / UNITS_PER_EM * sizePx, h = box[3]! / UNITS_PER_EM * sizePx;
  // Drop MathJax's CSS sizing (ex units, vertical-align) for SVG geometry in logical px.
  svg.removeAttribute("style");
  svg.removeAttribute("role");
  svg.removeAttribute("focusable");
  for (const [name, value] of [["width", w], ["height", h], ["x", 0], ["y", 0]] as const) svg.setAttribute(name, String(value));
  svg.setAttribute("overflow", "visible");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("color", INK.albert);
  svg.setAttribute("data-ink-math", latex);
  svg.remove();
  // viewBox y runs from -ascent (above the baseline) down to the descent.
  return { node: svg, w, h, glyphPaths: [], baseline: -box[1]! / UNITS_PER_EM * sizePx, fallback: false };
}

async function fallback(latex: string, sizePx: number): Promise<MathSvg> {
  await loadHandFont();
  const { w, h } = measureText(latex, sizePx);
  const svg = document.createElementNS(NS, "svg");
  for (const [name, value] of [["width", w], ["height", h], ["x", 0], ["y", 0]] as const) svg.setAttribute(name, String(value));
  svg.setAttribute("overflow", "visible");
  svg.setAttribute("data-ink-math", latex);
  svg.setAttribute("data-ink-math-fallback", "");
  svg.append(textNode(latex, sizePx));
  return { node: svg, w, h, glyphPaths: [], baseline: textBaseline(sizePx), fallback: true };
}

function copy(template: MathSvg): MathSvg {
  const node = template.node.cloneNode(true) as SVGSVGElement;
  return { ...template, node, glyphPaths: Array.from(node.querySelectorAll("path")) };
}
