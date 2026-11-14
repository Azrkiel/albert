import { STUCK, type Cluster, type Row, type SessionEvent, type Stroke, type StuckSignal } from "../contracts";

/** A deterministic tag against the clusters BEFORE this stroke. Ink stays visible in snapshots. */
export function crossOutClusterIds(stroke: Stroke, clusters: Cluster[]): string[] {
  if (stroke.tool !== "pen" || stroke.erasedAt !== undefined) return [];
  const box = stroke.bbox;
  const diagonal = Math.hypot(box.w, box.h);
  const length = stroke.points.slice(1).reduce((sum, point, i) => {
    const previous = stroke.points[i]!;
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
  if (!diagonal || length / diagonal < STUCK.CROSS_OUT_MIN_LENGTH_RATIO) return [];
  const existing = clusters.filter((c) => c.rowId === stroke.rowId && !c.strokeIds.includes(stroke.id));
  let area = 0;
  let covered = 0;
  const ids: string[] = [];
  for (const c of existing) {
    area += c.bbox.w * c.bbox.h;
    const overlap = Math.max(0, Math.min(box.x + box.w, c.bbox.x + c.bbox.w) - Math.max(box.x, c.bbox.x))
      * Math.max(0, Math.min(box.y + box.h, c.bbox.y + c.bbox.h) - Math.max(box.y, c.bbox.y));
    covered += overlap;
    if (overlap > 0) ids.push(c.id);
  }
  return area > 0 && covered / area >= STUCK.CROSS_OUT_COVERAGE ? ids : [];
}

/** Solved means the problem's latest recorded check_result is correct, until another check. */
export function isProblemSolved(events: SessionEvent[], problemId: string): boolean {
  const latest = events.findLast((event) => event.type === "check_result" && event.problemId === problemId);
  return latest?.type === "check_result" && latest.verdict === "correct";
}

/** Pure: time and live geometry are supplied by the caller. Rows can be bands or inferred lines. */
export function detectStuck(events: SessionEvent[], now: number, rows: Row[], clusters: Cluster[]): StuckSignal | null {
  const rowMap = new Map(rows.map((row) => [row.id, row]));
  const blocked = new Set<string>();
  const checks = new Map<string, boolean>();
  const pens: Stroke[] = [];
  let problemId: string | undefined;
  let action: SessionEvent | undefined;
  const edits: Extract<SessionEvent, { type: "erase" | "undo" }>[] = [];
  for (const event of events) {
    if (event.at > now) continue;
    if (event.type === "stroke_end" && event.stroke.tool === "pen" && event.stroke.erasedAt === undefined) {
      pens.push(event.stroke);
      problemId = event.stroke.problemId;
      for (const rowId of blocked) if (rowMap.get(rowId)?.problemId === problemId) blocked.delete(rowId);
      action = event;
    } else if (event.type === "stuck") blocked.add(event.signal.rowId);
    else if (event.type === "problem_opened") { problemId = event.problemId; action = event; }
    else if (event.type === "check_result") checks.set(event.problemId, event.verdict === "correct");
    else if (event.type === "erase" || event.type === "undo") {
      problemId = rowMap.get(event.rowId)?.problemId;
      action = event;
      if (event.type === "erase" || !event.redo) edits.push(event);
    }
  }
  if (!problemId || checks.get(problemId)) return null;
  const signal = (kind: StuckSignal["kind"], rowId: string, detail?: StuckSignal["detail"]): StuckSignal | null =>
    !rowMap.has(rowId) || blocked.has(rowId) ? null : { kind, problemId, rowId, at: now, ...(detail ? { detail } : {}) };

  // Edit signals belong to the current action, never to edits preceding new ink.
  if (action?.type === "erase" || action?.type === "undo" && !action.redo) {
    const recent = edits.filter((event) => event.rowId === action.rowId && now - event.at <= STUCK.ERASE_LOOP_WINDOW_MS);
    if (recent.length >= STUCK.ERASE_LOOP_COUNT) return signal("erase_loop", action.rowId, { eraseCount: recent.length });
  }
  if (action?.type === "stroke_end" && action.stroke.rowId) {
    const crossedClusterIds = crossOutClusterIds(action.stroke, clusters);
    if (crossedClusterIds.length) return signal("cross_out", action.stroke.rowId, { crossedClusterIds });
  }

  const liveIds = new Set(clusters.flatMap((cluster) => cluster.strokeIds));
  const lastInk = pens.findLast((stroke) => stroke.problemId === problemId && liveIds.has(stroke.id));
  const lastPen = pens.findLast((stroke) => stroke.problemId === problemId);
  if (!lastInk?.rowId || !lastPen) return null;
  const gaps = pens.slice(1).map((stroke, i) => Math.max(0, stroke.t0 - pens[i]!.t1)).sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[middle]! : ((gaps[middle - 1] ?? 0) + (gaps[middle] ?? 0)) / 2;
  const threshold = pens.length < 5 ? STUCK.PAUSE_MAX_MS
    : Math.min(STUCK.PAUSE_MAX_MS, Math.max(STUCK.PAUSE_MIN_MS, STUCK.PAUSE_FACTOR * median));
  const pauseMs = now - lastPen.t1;
  return pauseMs > threshold ? signal("pause", lastInk.rowId, { pauseMs }) : null;
}
