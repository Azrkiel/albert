import { PDFDocument } from "pdf-lib";
import type { Stroke } from "../contracts";
import { exportAnnotatedPdf } from "../ink/pdf-export";
import { addEditablePdfInk } from "./editable-pdf-ink";
import { mapCanvasToPdf, planNotePages, type AlbertPdfPage } from "./pdf-export-input";

/** Browser adapter around the foundation library: original pages + native student ink + labelled overflow notes. */
export async function buildPdfDownload(args: { pdf: Uint8Array; fontBytes: Uint8Array; strokes: readonly Stroke[]; albert: readonly AlbertPdfPage[] }): Promise<Uint8Array> {
  const original = await PDFDocument.load(args.pdf);
  const count = original.getPageCount();
  const mapping = mapCanvasToPdf(args.strokes, args.albert, Array.from({ length: count }, (_, i) => i + 1));
  const notes = planNotePages(mapping.notes, count);
  for (const note of notes) original.addPage([note.widthPt, note.heightPt]);
  const prepared = notes.length ? await original.save() : args.pdf;
  // Student strokes use native Ink annotations below, rather than being flattened into page content.
  const decorated = await exportAnnotatedPdf({ pdf: prepared, fontBytes: args.fontBytes,
    pages: [...mapping.pages.map(page => ({ ...page, strokes: [] })), ...notes] });
  return addEditablePdfInk(decorated, args.strokes);
}
