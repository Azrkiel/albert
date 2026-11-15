import fontkit from "@pdf-lib/fontkit";
import { concatTransformationMatrix, LineCapStyle, StandardFonts, PDFDocument, type PDFFont, type PDFPage, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { INK, PAGE, type BBox, type Stroke } from "../contracts";
import { strokePath } from "../canvas/path";
import { HAND_FONT } from "./font";
import { geometryOf, pageTransform } from "./pdf-export";

/** SVG/PDF affine matrix: x' = ax + cy + e; y' = bx + dy + f. */
export type PdfMatrix = readonly [number, number, number, number, number, number];
type Positioned = { transform?: PdfMatrix; fill?: string; bounds?: BBox; noteGroup?: { id: string; bounds: BBox } };
export type PdfAnnotationElement =
  | Positioned & { type: "path"; d: string; stroke?: string; strokeWidth?: number }
  | Positioned & { type: "text"; text: string; x: number; y: number; size: number };
export type PdfPageAnnotations = { page: number } & (
  | { svg: SVGSVGElement | SVGGElement; elements?: never }
  | { elements: readonly PdfAnnotationElement[]; svg?: never }
);
export type AnnotatedPdfOptions = {
  originalPdf: Uint8Array;
  /** Coordinates belong to the displayed PDF page at PAGE.width; absent page means page 1. */
  strokes: readonly (Stroke & { page?: number })[];
  /** Pass an annotation-only SVG or the live Albert <g>; nested MathJax transforms are retained. */
  annotations?: readonly PdfPageAnnotations[];
  /** Optional font bytes for offline callers; otherwise the bundled Kalam font is fetched when needed. */
  fontBytes?: Uint8Array;
};

/** Use the published exporter geometry for browser ink and SVG annotations too. */
export function displayedPageToPdf(page: PDFPage): PdfMatrix {
  return pageTransform(geometryOf(page)).matrix;
}

function matrix(value: DOMMatrix): PdfMatrix { return [value.a, value.b, value.c, value.d, value.e, value.f]; }

/** Snapshot live SVG geometry before async font loading; no rasterization or DOM mutation. */
export function pdfAnnotationsFromSvg(svg: SVGSVGElement | SVGGElement): PdfAnnotationElement[] {
  const root = svg.ownerSVGElement ?? svg as SVGSVGElement;
  const rootMatrix = root.getScreenCTM();
  if (!rootMatrix) throw new Error("Attach the annotation SVG before exporting PDF.");
  const inverse = rootMatrix.inverse();
  const elements: PdfAnnotationElement[] = [];
  const boxInPage = (node: SVGGraphicsElement, transform: PdfMatrix): BBox => {
    const box = node.getBBox();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => ({ x: transform[0] * x! + transform[2] * y! + transform[4], y: transform[1] * x! + transform[3] * y! + transform[5] }));
    const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
    return { x: left, y: top, w: Math.max(...corners.map(p => p.x)) - left, h: Math.max(...corners.map(p => p.y)) - top };
  };
  for (const node of svg.querySelectorAll<SVGGraphicsElement>("path, text, rect, line")) {
    if (node.closest("defs, clipPath, mask, [data-albert-dot], [data-live-stroke]")) continue;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const local = node.getScreenCTM();
    if (!local) throw new Error("Could not read annotation geometry.");
    const transform = matrix(inverse.multiply(local));
    if (!transform.every(Number.isFinite)) throw new Error("Invalid annotation transform.");
    const bounds = boxInPage(node, transform);
    const writing = node.closest<SVGGraphicsElement>("[data-albert-writing]");
    const groupMatrix = writing?.getScreenCTM();
    const hintId = writing?.closest("[data-albert-hint]")?.getAttribute("data-albert-hint");
    const noteGroup = writing && groupMatrix && hintId ? { id: hintId, bounds: boxInPage(writing, matrix(inverse.multiply(groupMatrix))) } : undefined;
    const fill = style.fill === "currentcolor" ? style.color : style.fill;
    if (node.localName === "text") {
      elements.push({ type: "text", text: node.textContent ?? "", x: numeric(node, "x"), y: numeric(node, "y"),
        size: parseFloat(style.fontSize), fill, transform, bounds, noteGroup });
      continue;
    }
    let d = node.getAttribute("d") ?? "";
    if (node.localName === "rect") {
      const x = numeric(node, "x"), y = numeric(node, "y"), w = numeric(node, "width"), h = numeric(node, "height");
      d = `M${x} ${y}h${w}v${h}h${-w}Z`;
    } else if (node.localName === "line") {
      d = `M${numeric(node, "x1")} ${numeric(node, "y1")}L${numeric(node, "x2")} ${numeric(node, "y2")}`;
    }
    if (d) elements.push({ type: "path", d, fill, stroke: style.stroke, strokeWidth: parseFloat(style.strokeWidth), transform, bounds, noteGroup });
  }
  return elements;
}

function numeric(node: Element, name: string) { return parseFloat(node.getAttribute(name) ?? "0"); }
function color(value?: string) {
  if (!value || value === "none" || value === "transparent") return undefined;
  const hex = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(value);
  if (hex) {
    const expanded = hex[1]!.length === 3 ? [...hex[1]!].map(c => c + c).join("") : hex[1]!;
    return rgb(parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255, parseInt(expanded.slice(4, 6), 16) / 255);
  }
  const channels = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (channels) return rgb(Number(channels[1]) / 255, Number(channels[2]) / 255, Number(channels[3]) / 255);
  throw new Error(`Unsupported annotation color: ${value}`);
}
function transformPage(page: PDFPage, transform: PdfMatrix) {
  if (!transform.every(Number.isFinite)) throw new Error("Invalid annotation transform.");
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...transform));
}
function drawPath(page: PDFPage, d: string, fill?: string, stroke?: string, strokeWidth = 0) {
  const filling = color(fill), border = color(stroke);
  if (!filling && !border) return;
  // pdf-lib drawSvgPath adds its own SVG y flip; cancel it because our viewport already maps SVG coordinates.
  transformPage(page, [1, 0, 0, -1, 0, 0]);
  page.drawSvgPath(d, { x: 0, y: 0, color: filling, borderColor: border,
    borderWidth: border ? strokeWidth : 0, borderLineCap: LineCapStyle.Round });
  page.pushOperators(popGraphicsState());
}

/** Copy the original document and append vector ink without changing its page geometry or printed content. */
export async function exportWorksheetPdf(options: AnnotatedPdfOptions): Promise<Uint8Array> {
  const annotations = (options.annotations ?? []).map(item => ({ page: item.page, elements: item.svg ? pdfAnnotationsFromSvg(item.svg) : item.elements }));
  const pdf = await PDFDocument.load(options.originalPdf, { updateMetadata: false });
  const originalCount = pdf.getPageCount();
  const pageAt = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 1 || n > originalCount) throw new Error(`No such PDF page: ${n}`);
    return pdf.getPage(n - 1);
  };
  let font: PDFFont | undefined;
  if (annotations.some(item => item.elements.some(element => element.type === "text" && element.text))) {
    let bytes = options.fontBytes;
    if (!bytes) {
      const response = await fetch(HAND_FONT.file);
      if (!response.ok) throw new Error("Could not load the PDF handwriting font.");
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(bytes, { subset: true });
  }
  for (const stroke of options.strokes) {
    if (stroke.erasedAt !== undefined || stroke.tool !== "pen") continue;
    const page = pageAt(stroke.page ?? 1), d = strokePath(stroke.points);
    if (!d) continue;
    transformPage(page, displayedPageToPdf(page));
    drawPath(page, d, INK.student);
    page.pushOperators(popGraphicsState());
  }
  const notes = new Map<number, { page: PDFPage; cursor: number; count: number }>();
  const placements = new Map<string, { page: PDFPage; shift: number }>();
  let ungrouped = 0;
  let headingFont: PDFFont | undefined;
  for (const item of annotations) {
    const original = pageAt(item.page);
    const viewport = pageTransform(geometryOf(original));
    const scale = viewport.scale, displayHeight = viewport.height;
    for (const element of item.elements) {
      let page = original;
      const group = element.noteGroup ?? (element.bounds ? { id: `element-${ungrouped++}`, bounds: element.bounds } : undefined);
      const below = group && group.bounds.y >= displayHeight;
      let shift = 0;
      if (below) {
        const key = `${item.page}/${group.id}`;
        let placement = placements.get(key);
        if (!placement) {
          const available = displayHeight - 116;
          if (group.bounds.h > available) throw new Error("Tutor note is too tall to fit on a PDF notes page.");
          let sheet = notes.get(item.page);
          if (!sheet || sheet.cursor + group.bounds.h > displayHeight - 40) {
            const count = (sheet?.count ?? 0) + 1;
            page = pdf.addPage([PAGE.width * scale, displayHeight * scale]);
            sheet = { page, cursor: 76, count };
            notes.set(item.page, sheet);
            headingFont ??= await pdf.embedFont(StandardFonts.Helvetica);
            page.drawText(`Albert notes - page ${item.page}${count > 1 ? ` (continued ${count})` : ""}`, {
              x: 24 * scale, y: (displayHeight - 38) * scale, size: 24 * scale, font: headingFont, color: rgb(.4, .4, .4),
            });
          }
          placement = { page: sheet.page, shift: sheet.cursor - group.bounds.y };
          placements.set(key, placement);
          sheet.cursor += group.bounds.h + 24;
        }
        page = placement.page;
        shift = placement.shift;
      }
      transformPage(page, displayedPageToPdf(page));
      if (shift) transformPage(page, [1, 0, 0, 1, 0, shift]);
      if (element.transform) transformPage(page, element.transform);
      if (element.type === "path") drawPath(page, element.d, element.fill, element.stroke, element.strokeWidth);
      else if (element.text && font) {
        const fill = color(element.fill ?? INK.albert);
        if (fill) {
          transformPage(page, [1, 0, 0, -1, element.x, element.y]);
          page.drawText(element.text, { x: 0, y: 0, size: element.size, font, color: fill });
          page.pushOperators(popGraphicsState());
        }
      }
      if (element.transform) page.pushOperators(popGraphicsState());
      if (shift) page.pushOperators(popGraphicsState());
      page.pushOperators(popGraphicsState());
    }
  }
  return pdf.save();
}
