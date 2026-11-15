const NS = "http://www.w3.org/2000/svg";

/**
 * P4.6 "Save page": the problem's work surface as a standalone SVG with both inks (the student's strokes and
 * Albert's marks and writing). Live-only and interactive parts are dropped; the hand font is named by family, so
 * the file shows it where the font is installed and a cursive fallback elsewhere.
 */
export function pageSvgMarkup(surface: SVGSVGElement): string {
  const clone = surface.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.removeAttribute("role");
  clone.removeAttribute("data-capture-ready");
  clone.setAttribute("xmlns", NS);
  clone.querySelectorAll("[data-live-stroke], [data-albert-dot]").forEach((el) => el.remove());
  clone.querySelectorAll("[data-faded]").forEach((el) => el.removeAttribute("data-faded"));
  const viewBox = clone.viewBox.baseVal;
  clone.setAttribute("width", String(viewBox.width));
  clone.setAttribute("height", String(viewBox.height));
  const background = document.createElementNS(NS, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#ffffff");
  clone.prepend(background);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}
