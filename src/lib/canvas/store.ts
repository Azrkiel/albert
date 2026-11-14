import type { Cluster, Row, SessionEvent, SessionRecording, Stroke } from "../contracts";
import { clusterRow } from "./clusters";
import { assignRow, createRows, ensureRows } from "./rows";

export type SessionState = {
  worksheetId: string;
  problems: SessionRecording["problems"];
  rows: Row[];
  strokes: Stroke[];
  /** Clusters per row id, recomputed only for rows whose strokes changed. Derived, never exported. */
  clusters: Record<string, Cluster[]>;
  events: SessionEvent[];
  durationMs: number;
  notes?: string;
};

export function createSessionState(problems: string[] | SessionRecording["problems"], worksheetId = "demo", rows?: Row[]): SessionState {
  const metadata = problems.map((problem) => typeof problem === "string"
    ? { id: problem, label: problem, statementLatex: "" } : { ...problem });
  return { worksheetId, problems: metadata, rows: rows ? structuredClone(rows) : metadata.flatMap(({ id }) => createRows(id)),
    strokes: [], clusters: {}, events: [], durationMs: 0 };
}

/** Every row's clusters in row order, for detectStuck and renderSnapshot. */
export function listClusters(state: Pick<SessionState, "rows" | "clusters">, rowIds?: string[]): Cluster[] {
  const wanted = rowIds ? new Set(rowIds) : undefined;
  return state.rows.filter((row) => !wanted || wanted.has(row.id)).flatMap((row) => state.clusters[row.id] ?? []);
}

/**
 * Rows whose strokes differ between two stroke lists. Event-agnostic: whatever erase, undo or
 * redo does to strokes (P2.4 owns those semantics), only rows it actually touched recompute.
 */
function changedRows(before: Stroke[], after: Stroke[]): Set<string> {
  const previous = new Map(before.map((stroke) => [stroke.id, stroke]));
  const rows = new Set<string>();
  for (const stroke of after) {
    const old = previous.get(stroke.id);
    previous.delete(stroke.id);
    if (old === stroke) continue;
    if (stroke.rowId) rows.add(stroke.rowId);
    if (old?.rowId) rows.add(old.rowId);
  }
  for (const gone of previous.values()) if (gone.rowId) rows.add(gone.rowId);
  return rows;
}

/** Recompute clusters only for rows whose strokes changed; untouched rows keep their arrays. */
export function reclusterChanged(before: SessionState, after: SessionState): SessionState {
  if (before.strokes === after.strokes) return after;
  const rows = changedRows(before.strokes, after.strokes);
  if (!rows.size) return after;
  const clusters = { ...after.clusters };
  for (const rowId of rows) clusters[rowId] = clusterRow(after.strokes, rowId);
  return { ...after, clusters };
}

/** Stroke-level effect of one event. P2.4 owns erase/undo/redo semantics here. */
function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  let strokes = state.strokes;
  let rows = state.rows;
  if (event.type === "stroke_end") {
    const stroke = structuredClone(event.stroke);
    if (strokes.some((existing) => existing.id === stroke.id)) return state;
    if (!state.problems.some((problem) => problem.id === stroke.problemId)) throw new Error("Unknown problem");
    stroke.rowId ??= assignRow(stroke, rows);
    if (!rows.some((row) => row.id === stroke.rowId && row.problemId === stroke.problemId)) throw new Error("Unknown row");
    event = { ...event, stroke };
    strokes = [...strokes, stroke];
    rows = ensureRows(rows, strokes);
  } else if (event.type === "erase" || event.type === "undo") {
    // Minimal placeholder until P2.4 lands: stamp erasedAt on live listed strokes (never delete).
    const ids = new Set(event.strokeIds);
    if (strokes.some((stroke) => ids.has(stroke.id) && stroke.erasedAt === undefined)) {
      strokes = strokes.map((stroke) => ids.has(stroke.id) && stroke.erasedAt === undefined
        ? { ...stroke, erasedAt: event.at } : stroke);
    }
  }
  return { ...state, strokes, rows, events: [...state.events, structuredClone(event)],
    durationMs: Math.max(state.durationMs, event.at) };
}

/** Both live completion and replay enter here. Recorded associations stay authoritative. */
export function reduceSessionEvent(state: SessionState, event: SessionEvent): SessionState {
  const next = applySessionEvent(state, event);
  return next === state ? state : reclusterChanged(state, next);
}

/** The block supplies identity; capture's draft is never mutated. No clocks or IO. */
export function addCompletedStroke(state: SessionState, problemId: string, captured: Stroke): SessionState {
  return reduceSessionEvent(state, { type: "stroke_end", at: captured.t1, stroke: { ...captured, problemId, rowId: null } });
}
