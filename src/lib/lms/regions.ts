import { PAGE, type Worksheet } from "../contracts";

/** PDF text boxes in displayed point coordinates, with the origin at the top left. */
export type PageTextItem = { str: string; x: number; y: number; width: number; height: number };
export type PageSize = { page: number; widthPt: number; heightPt: number };
type Region = NonNullable<Worksheet["problems"][number]["region"]>;

/** Printed labels define full-width vertical bands; absent labels leave ownership to the picker. */
export function regionsFromText(items: readonly PageTextItem[], labels: readonly string[], pageSize: PageSize): Array<Region & { label: string }> {
  const { page, widthPt, heightPt } = pageSize;
  const scale = PAGE.width / widthPt;
  const patterns = labels.map(label => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { label, pattern: new RegExp(`^(?:Problem\\s+${escaped}(?:[.:)]|\\s|$)|${escaped}[.)](?:\\s|$))`, "i") };
  });
  const found: Array<{ label: string; y: number }> = [];
  const seen = new Set<string>();
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (item.x < 0 || item.x > widthPt * 0.18 || item.y < 0 || item.y >= heightPt) continue;
    const match = patterns.find(({ label, pattern }) => !seen.has(label) && pattern.test(item.str.trim()));
    if (!match) continue;
    seen.add(match.label);
    found.push({ label: match.label, y: item.y * scale });
  }
  return found.map(({ label, y }, i) => ({
    label, page, bbox: { x: 0, y, w: PAGE.width, h: (found[i + 1]?.y ?? heightPt * scale) - y },
  }));
}
