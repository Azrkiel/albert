import { PAGE, type BBox, type InkSegment, type Row } from "../contracts";
import { WRITE } from "./constants";

export type Measure = (seg: InkSegment, size: number) => { w: number; h: number };
export type LayoutItem = {
  seg: InkSegment | { type: "citation"; text: string };
  x: number; y: number; w: number; h: number; line: number;
};

/**
 * Item x/y is its measured top-left, not a text baseline. Lines reserve at
 * least lineHeight, growing for tall math. Citation is one final line.
 * Throws RangeError for invalid measurements or indivisible content wider
 * than the usable column; never clips, splits words/math, or silently scales.
 */
export function layoutHint(args: {
  row: Row; segments: InkSegment[]; citation?: string;
  measure: Measure; occupied: BBox[];
}): { items: LayoutItem[]; bbox: BBox } {
  const left = PAGE.albertCol.x + WRITE.padX;
  const width = PAGE.albertCol.w - 2 * WRITE.padX;
  const top = args.row.bbox.y + PAGE.rowPaddingTop;
  const items: LayoutItem[] = [];
  let x = left, y = top, line = 0;
  let lineHeight: number = WRITE.lineHeight;
  let hasLineItem = false;
  let whitespace = "";

  const measured = (seg: InkSegment, size: number) => {
    const result = args.measure(seg, size);
    if (![result.w, result.h].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new RangeError("Ink measurement must have finite, nonnegative width and height");
    }
    return result;
  };
  const nextLine = () => {
    y += lineHeight;
    x = left;
    line++;
    lineHeight = WRITE.lineHeight;
    hasLineItem = false;
    whitespace = "";
  };
  const place = (seg: LayoutItem["seg"], size: number) => {
    const content: InkSegment = seg.type === "citation" ? { type: "text", text: seg.text } : seg;
    const { w, h } = measured(content, size);
    if (w > width) throw new RangeError(`Ink ${seg.type} width ${w} exceeds column width ${width}`);
    let gap = hasLineItem && whitespace ? measured({ type: "text", text: whitespace }, size).w : 0;
    if (hasLineItem && x - left + gap + w > width) {
      nextLine();
      gap = 0;
    }
    x += gap;
    items.push({ seg, x, y, w, h, line });
    x += w;
    lineHeight = Math.max(lineHeight, h);
    hasLineItem = true;
    whitespace = "";
  };

  for (const seg of args.segments) {
    if (seg.type === "break") nextLine();
    else if (seg.type === "math") place(seg, WRITE.fontSize);
    else for (const token of seg.text.match(/\s+|\S+/gu) ?? []) {
      if (/^\s+$/u.test(token)) whitespace += token;
      else place({ type: "text", text: token }, WRITE.fontSize);
    }
  }
  if (args.citation !== undefined && args.citation !== "") {
    if (hasLineItem) nextLine();
    place({ type: "citation", text: args.citation }, WRITE.citationSize);
  }

  const bbox: BBox = { x: left, y: top,
    w: Math.max(0, ...items.map((item) => item.x + item.w - left)),
    h: items.length || line > 0 ? y + lineHeight - top : 0 };
  const overlaps = (box: BBox) => bbox.w > 0 && bbox.h > 0 && box.w > 0 && box.h > 0
    && bbox.x < box.x + box.w && bbox.x + bbox.w > box.x
    && bbox.y < box.y + box.h && bbox.y + bbox.h > box.y;
  // Jump by whole lineHeight steps past the first collision, then recheck
  // every box. This is equivalent to stepping, without scanning empty space.
  let collision: BBox | undefined;
  while ((collision = args.occupied.find(overlaps))) {
    bbox.y += Math.max(1, Math.ceil((collision.y + collision.h - bbox.y) / WRITE.lineHeight)) * WRITE.lineHeight;
  }
  const offset = bbox.y - top;
  return { items: items.map((item) => ({ ...item, y: item.y + offset })), bbox };
}
