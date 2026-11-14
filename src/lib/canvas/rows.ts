import { PAGE, type Point, type Row, type Stroke } from "../contracts";

export function createRows(problemId: string): Row[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `${problemId}/r${index + 1}`, problemId, index: index + 1,
    bbox: { x: PAGE.studentCol.x, y: PAGE.statementMinHeight + index * PAGE.rowHeight,
      w: PAGE.studentCol.w, h: PAGE.rowHeight },
  }));
}

// Bands are half-open at the bottom, so a shared boundary belongs to the next row.
// Capture preserves raw samples outside the student clip; those are not row ink.
function containsPoint(row: Row, point: Point): boolean {
  return point.x >= row.bbox.x && point.x < row.bbox.x + row.bbox.w
    && point.y >= row.bbox.y && point.y < row.bbox.y + row.bbox.h;
}

/** Largest point share wins; ties go to the row containing the first point. */
export function assignRow(stroke: Stroke, rows: Row[]): string {
  const candidates = rows.filter((row) => row.problemId === stroke.problemId);
  const first = stroke.points[0];
  if (!first || !candidates.length) throw new Error("Row assignment needs points and rows for the problem");
  const counts = candidates.map((row) => stroke.points.filter((point) => containsPoint(row, point)).length);
  const most = Math.max(...counts);
  const tied = candidates.filter((_, index) => counts[index] === most);
  const firstRow = candidates.find((row) => containsPoint(row, first));
  if (tied.length > 1 && firstRow) return firstRow.id;
  // Captured strokes can finish outside the SVG. If no point is in a band, use
  // the nearest row to the first point; otherwise retain stable row order.
  if (most === 0) {
    const distance = (row: Row) => Math.max(row.bbox.y - first.y, first.y - row.bbox.y - row.bbox.h, 0);
    return tied.reduce((nearest, row) => distance(row) < distance(nearest) ? row : nearest).id;
  }
  return tied[0]!.id;
}

/** Keep one blank row beyond each problem's last inked band; never mutate input. */
export function ensureRows(rows: Row[], strokes: Stroke[]): Row[] {
  const lastByProblem = new Map<string, Row>();
  for (const row of rows) {
    const last = lastByProblem.get(row.problemId);
    if (!last || row.index > last.index) lastByProblem.set(row.problemId, row);
  }
  const appended: Row[] = [];
  for (const last of lastByProblem.values()) {
    const hasInk = strokes.some((stroke) => stroke.problemId === last.problemId
      && stroke.tool === "pen" && stroke.erasedAt === undefined
      && stroke.points.some((point) => containsPoint(last, point)));
    if (hasInk) appended.push({
      id: `${last.problemId}/r${last.index + 1}`, problemId: last.problemId, index: last.index + 1,
      bbox: { x: last.bbox.x, y: last.bbox.y + last.bbox.h, w: last.bbox.w, h: PAGE.rowHeight },
    });
  }
  return [...rows, ...appended];
}
