import { type BBox } from "../contracts";
import { textBaseline } from "../ink/font";
import type { ExportMath, ExportText, Matrix } from "../ink/pdf-export";
import type { AlbertPdfPage, PdfNote } from "./pdf-export-input";

function matrixOf(element: SVGGraphicsElement, root: SVGGraphicsElement): DOMMatrix {
  const from = element.getScreenCTM(), to = root.getScreenCTM();
  if (!from || !to) throw new Error("PDF page is not rendered");
  return to.inverse().multiply(from);
}
const tuple = (m: DOMMatrix): Matrix => [m.a, m.b, m.c, m.d, m.e, m.f];
function boxOf(element: SVGGraphicsElement, root: SVGGraphicsElement): BBox {
  const b = element.getBBox(), m = matrixOf(element, root);
  const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
  const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
  return { x, y, w: Math.max(...corners.map(p => p.x)) - x, h: Math.max(...corners.map(p => p.y)) - y };
}

/** The export library accepts colours; preserve visible ghost hints by blending their opacity over paper. */
function inkColor(element: SVGElement, root: SVGSVGElement): string {
  let alpha = 1;
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) alpha *= Number(getComputedStyle(node).opacity);
  const fill = getComputedStyle(element).fill;
  const numbers = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(fill);
  const rgb = numbers ? numbers.slice(1, 4).map(Number) : [200, 50, 30];
  return `#${rgb.map(c => Math.round(255 + (c - 255) * alpha).toString(16).padStart(2, "0")).join("")}`;
}

function writingOf(group: SVGGraphicsElement, root: SVGSVGElement): { texts: ExportText[]; math: ExportMath[] } {
  const texts = [...group.querySelectorAll<SVGTextElement>("text")].map(text => {
    const m = matrixOf(text, root);
    const size = Number(text.getAttribute("font-size") ?? 26);
    const x = Number(text.getAttribute("x") ?? 0), baseline = Number(text.getAttribute("y") ?? textBaseline(size));
    const top = new DOMPoint(x, baseline - textBaseline(size)).matrixTransform(m);
    return { text: text.textContent ?? "", x: top.x, y: top.y, size: size * Math.hypot(m.a, m.b), color: inkColor(text, root) };
  });
  const math = [...group.querySelectorAll<SVGSVGElement>("svg[data-ink-math]:not([data-ink-math-fallback])")].map(svg => {
    const width = Number(svg.getAttribute("width")), height = Number(svg.getAttribute("height"));
    const view = svg.viewBox.baseVal;
    const parent = svg.parentElement as unknown as SVGGraphicsElement;
    const parentMatrix = matrixOf(parent, root);
    const top = new DOMPoint(Number(svg.getAttribute("x") ?? 0), Number(svg.getAttribute("y") ?? 0)).matrixTransform(parentMatrix);
    return { x: top.x, y: top.y, width: width * Math.hypot(parentMatrix.a, parentMatrix.b), height: height * Math.hypot(parentMatrix.c, parentMatrix.d),
      viewBox: [view.x, view.y, view.width, view.height] as const, color: inkColor(svg.querySelector<SVGPathElement>("path") ?? svg, root),
      paths: [...svg.querySelectorAll<SVGPathElement>("path")].map(path => ({ d: path.getAttribute("d") ?? "", matrix: tuple(matrixOf(path, svg)) })),
    };
  });
  return { texts, math };
}

/** Capture only Albert's rendered layer; printed page images and student paths stay separate. */
export function captureAlbertPdf(surfaces: readonly SVGSVGElement[]): AlbertPdfPage[] {
  return surfaces.map(root => {
    const page = Number(root.dataset.page);
    const height = root.querySelector<SVGImageElement>("image[data-pdf-background]")?.height.baseVal.value ?? 0;
    const notes: PdfNote[] = [], texts: ExportText[] = [], math: ExportMath[] = [];
    const marks = [...root.querySelectorAll<SVGGElement>("g.albert [data-mark-kind]")].map(group => ({
      paths: [...group.querySelectorAll<SVGPathElement>("path")].map(path => path.getAttribute("d") ?? ""), color: inkColor(group, root),
    }));
    for (const [index, group] of [...root.querySelectorAll<SVGGElement>("g.albert [data-albert-writing], g.albert [data-albert-note]")].entries()) {
      const content = writingOf(group, root);
      const bbox = boxOf(group, root);
      if (bbox.y + bbox.h > height) notes.push({ id: group.closest("[data-albert-hint]")?.getAttribute("data-albert-hint") ?? `note-${index}`, page, bbox, ...content });
      else { texts.push(...content.texts); math.push(...content.math); }
    }
    return { page, marks, texts, math, notes };
  });
}
