import { PDFDocument, PDFName, PDFString, concatTransformationMatrix, drawSvgPath, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { INK, type Stroke } from "../contracts";
import { geometryOf, pageTransform } from "../ink/pdf-export";
import { strokeOutline, strokePath } from "./path";

/** Native PDF Ink annotations, one per pen stroke. Edge can select/erase these independently of the printed page. */
export async function addEditablePdfInk(bytes: Uint8Array, strokes: readonly Stroke[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const color = INK.student;
  const components = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
  for (const stroke of strokes) {
    if (stroke.tool !== "pen" || stroke.erasedAt !== undefined || !stroke.page || !stroke.points.length) continue;
    const page = doc.getPage(stroke.page - 1);
    const transform = pageTransform(geometryOf(page));
    const outline = strokeOutline(stroke.points).map(([x, y]) => transform.toPdf(x, y));
    if (!outline.length) continue;
    const x = Math.min(...outline.map(p => p.x)), y = Math.min(...outline.map(p => p.y));
    const w = Math.max(0.001, Math.max(...outline.map(p => p.x)) - x);
    const h = Math.max(0.001, Math.max(...outline.map(p => p.y)) - y);
    const [a, b, c, d, e, f] = transform.matrix;
    // drawSvgPath flips SVG y internally; cancel that flip before applying the displayed-page transform.
    const appearance = doc.context.register(doc.context.contentStream([
      pushGraphicsState(), concatTransformationMatrix(a, b, -c, -d, e - x, f - y),
      ...drawSvgPath(strokePath(stroke.points), { x: 0, y: 0, scale: 1, color: rgb(components[0]!, components[1]!, components[2]!), borderColor: undefined, borderWidth: 0 }),
      popGraphicsState(),
    ], { Type: "XObject", Subtype: "Form", FormType: 1, BBox: [0, 0, w, h], Matrix: [1, 0, 0, 1, 0, 0], Resources: {} }));
    let points = stroke.points.flatMap(p => { const q = transform.toPdf(p.x, p.y); return [q.x, q.y]; });
    if (points.length === 2) points = [...points, ...points]; // A tap remains an editable ink dot.
    const annot = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Ink", P: page.ref, Rect: [x, y, x + w, y + h],
      InkList: [points], C: components, BS: { Type: "Border", S: "S", W: 4 * transform.scale },
      F: 4, CA: 1, NM: PDFString.of(stroke.id), T: PDFString.of("Student"),
      Contents: PDFString.of("Handwriting"), AP: { N: appearance },
    }));
    // addAnnot() normalizes page content by adding q/Q wrapper streams. Append the annotation
    // directly so the original page content streams remain byte-for-byte unchanged.
    const existing = page.node.Annots();
    if (existing) existing.push(annot);
    else page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
  }
  return doc.save();
}
