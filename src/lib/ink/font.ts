import { INK } from "../contracts";

/**
 * Albert's handwriting font (P4.2, level 0). The @font-face rule is in
 * ./ink.css; the file and its SIL OFL licence are in public/fonts/.
 */
export const HAND_FONT = { family: "Albert Hand", file: "/fonts/Kalam-Regular.ttf" } as const;
const FAMILY = `"${HAND_FONT.family}", cursive`;
const NS = "http://www.w3.org/2000/svg";

/** Height of one line of hand text, and where its baseline sits below the top. */
export const textHeight = (size: number) => Math.round(size * 1.25);
export const textBaseline = (size: number) => Math.round(size * 0.95);

let fontLoad: Promise<void> | null = null;
/** Starts the font download once and resolves when `document.fonts` is ready. Measure only after this. */
export function loadHandFont(): Promise<void> {
  fontLoad ??= document.fonts.load(`26px ${FAMILY}`).then(() => document.fonts.ready).then(() => undefined, () => undefined);
  return fontLoad;
}

/** One SVG `<text>` in the hand font, filled with Albert's red; (0, 0) is its top-left. */
export function textNode(text: string, size: number): SVGTextElement {
  const node = document.createElementNS(NS, "text");
  node.textContent = text;
  node.setAttribute("x", "0");
  node.setAttribute("y", String(textBaseline(size)));
  node.setAttribute("font-family", FAMILY);
  node.setAttribute("font-size", String(size));
  node.setAttribute("fill", INK.albert);
  node.setAttribute("data-ink-text", "");
  node.style.whiteSpace = "pre";
  // Unhinted advances scale linearly, so a width measured unscaled matches the scaled page.
  // Without it Linux Chrome measured 3.8 px wider than it drew (CI, PR #27).
  node.setAttribute("text-rendering", "geometricPrecision");
  return node;
}

let probe: SVGTextElement | null = null;
/** Width from getComputedTextLength() on a hidden (laid out, not displayed) element. */
export function measureText(text: string, size: number): { w: number; h: number } {
  if (!probe?.isConnected) {
    const host = document.createElementNS(NS, "svg");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("data-ink-measure", "");
    host.style.cssText = "position:absolute;left:-9999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden";
    probe = textNode("", size);
    host.append(probe);
    document.body.append(host);
  }
  probe.textContent = text;
  probe.setAttribute("font-size", String(size));
  return { w: text ? probe.getComputedTextLength() : 0, h: textHeight(size) };
}
