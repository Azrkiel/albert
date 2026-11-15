import type { InkSegment } from "../contracts";

const OPEN = /[([{]$/u;
const CLOSE = /^[,.;:!?)\]}%—–]/u;

/**
 * Models send hint text and math as separate segments with no spacing between them
 * ("find" + dx + "— what"). Put one space between text and math, and between two math
 * segments, unless whitespace is already there or the join is punctuation. Text-to-text
 * joins are left alone: a split inside a word is the model's choice.
 */
export function spaceSegments(segments: InkSegment[]): InkSegment[] {
  const out: InkSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.type !== "break" && seg.type !== "break" && (prev.type === "math" || seg.type === "math")) {
      const tight = (prev.type === "text" && (/\s$/u.test(prev.text) || OPEN.test(prev.text)))
        || (seg.type === "text" && (/^\s/u.test(seg.text) || CLOSE.test(seg.text)));
      if (!tight) out.push({ type: "text", text: " " });
    }
    out.push(seg);
  }
  return out;
}

/** Math as its LaTeX source, for when typesetting fails or a formula is wider than the column. */
export function mathAsText(segments: InkSegment[]): InkSegment[] {
  return segments.map((seg) => seg.type === "math" ? { type: "text", text: seg.latex } : seg);
}

/**
 * Last resort for layoutHint's RangeError: breaks any word wider than `maxWidth` into
 * pieces that fit, separated by spaces, so the text wraps instead of being dropped.
 */
export function breakLongWords(text: string, maxWidth: number, measure: (text: string) => number): string {
  return text.split(/(\s+)/u).map((word) => {
    if (!word || /^\s+$/u.test(word) || measure(word) <= maxWidth) return word;
    const pieces: string[] = [];
    let piece = "";
    for (const char of word) {
      if (piece && measure(piece + char) > maxWidth) { pieces.push(piece); piece = ""; }
      piece += char;
    }
    if (piece) pieces.push(piece);
    return pieces.join(" ");
  }).join("");
}

/** Greedy line wrap for short plain notes. */
export function wrapLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
