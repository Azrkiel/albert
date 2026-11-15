import { PAGE, type BBox, type Stroke } from "../contracts";
import type { ExportMath, ExportPage, ExportText } from "../ink/pdf-export";

export type PdfNote = { id: string; page: number; bbox: BBox; texts: ExportText[]; math: ExportMath[] };
export type AlbertPdfPage = ExportPage & { notes?: PdfNote[] };
export type PdfCanvasMapping = { pages: ExportPage[]; notes: PdfNote[] };

/** Page ownership is explicit; erased/eraser/unpaged ink never enters a PDF export. No DOM or mutation. */
export function mapCanvasToPdf(strokes: readonly Stroke[], albert: readonly AlbertPdfPage[], pageNumbers: readonly number[]): PdfCanvasMapping {
  const pages = pageNumbers.map(page => {
    const local = albert.filter(entry => entry.page === page);
    return { page,
      strokes: strokes.filter(s => s.page === page && s.tool === "pen" && s.erasedAt === undefined).map(s => ({ points: s.points })),
      marks: local.flatMap(p => p.marks ?? []), texts: local.flatMap(p => p.texts ?? []), math: local.flatMap(p => p.math ?? []),
    };
  });
  return { pages, notes: albert.filter(p => pageNumbers.includes(p.page)).flatMap(p => p.notes ?? []) };
}

export const NOTE_PAGE = { widthPt: 612, heightPt: 792, pad: 24, header: 96, gap: 24 } as const;
export type NotePagePlan = ExportPage & { widthPt: number; heightPt: number; sourcePage: number };

/** Append labelled note pages; original page geometry stays untouched. Whole notes are kept together. */
export function planNotePages(notes: readonly PdfNote[], originalPageCount: number): NotePagePlan[] {
  const result: NotePagePlan[] = [];
  const height = PAGE.width * NOTE_PAGE.heightPt / NOTE_PAGE.widthPt;
  const usableH = height - NOTE_PAGE.header - NOTE_PAGE.pad;
  const usableW = PAGE.width - 2 * NOTE_PAGE.pad;
  let current: NotePagePlan | undefined;
  let y = NOTE_PAGE.header;
  for (const note of [...notes].sort((a, b) => a.page - b.page || a.bbox.y - b.bbox.y || a.id.localeCompare(b.id))) {
    const scale = Math.min(1, usableH / Math.max(1, note.bbox.h), usableW / Math.max(1, note.bbox.w));
    const h = note.bbox.h * scale;
    if (!current || current.sourcePage !== note.page || y + h > height - NOTE_PAGE.pad) {
      current = { page: originalPageCount + result.length + 1, widthPt: NOTE_PAGE.widthPt, heightPt: NOTE_PAGE.heightPt,
        sourcePage: note.page, texts: [{ text: `Albert notes for page ${note.page}`, x: NOTE_PAGE.pad, y: 24, size: 24, color: "#76726b" }], math: [] };
      result.push(current);
      y = NOTE_PAGE.header;
    }
    const xOf = (x: number) => NOTE_PAGE.pad + (x - note.bbox.x) * scale;
    const yOf = (top: number) => y + (top - note.bbox.y) * scale;
    current.texts = [...current.texts ?? [], ...note.texts.map(t => ({ ...t, x: xOf(t.x), y: yOf(t.y), size: t.size * scale }))];
    current.math = [...current.math ?? [], ...note.math.map(m => ({ ...m, x: xOf(m.x), y: yOf(m.y), width: m.width * scale, height: m.height * scale }))];
    y += h + NOTE_PAGE.gap;
  }
  return result;
}
