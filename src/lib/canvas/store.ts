import type { Cluster, Row, SessionEvent, SessionRecording, Stroke } from "../contracts";
import { clusterRow } from "./clusters";
import { assignRow, createRows, ensureRows } from "./rows";

type Edit = { kind: "draw" | "erase"; strokeIds: string[]; rowId: string };

export type SessionState = {
  worksheetId: string;
  problems: SessionRecording["problems"];
  rows: Row[];
  strokes: Stroke[];
  /** Clusters per row id, recomputed only for rows whose strokes changed. Derived, never exported. */
  clusters: Record<string, Cluster[]>;
  events: SessionEvent[];
  durationMs: number;
  undoStack: Edit[];
  redoStack: Edit[];
  notes?: string;
};

export function createSessionState(problems: string[] | SessionRecording["problems"], worksheetId = "demo", rows?: Row[]): SessionState {
  const metadata = problems.map((problem) => typeof problem === "string"
    ? { id: problem, label: problem, statementLatex: "" } : { ...problem });
  return { worksheetId, problems: metadata, rows: rows ? structuredClone(rows) : metadata.flatMap(({ id }) => createRows(id)),
    strokes: [], clusters: {}, events: [], durationMs: 0, undoStack: [], redoStack: [] };
}

/** Every row's clusters in row order, for detectStuck and renderSnapshot. */
export function listClusters(state: Pick<SessionState, "rows" | "clusters">, rowIds?: string[]): Cluster[] {
  const wanted = rowIds ? new Set(rowIds) : undefined;
  return state.rows.filter((row) => !wanted || wanted.has(row.id)).flatMap((row) => state.clusters[row.id] ?? []);
}

/** Rows whose strokes differ between two stroke lists. Event-agnostic, so erase/undo/redo semantics stay in one place. */
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

/** Stroke-level effect of one event: rows, erase/undo/redo (P2.4). */
function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  let strokes = state.strokes;
  let rows = state.rows;
  let undoStack = state.undoStack;
  let redoStack = state.redoStack;
  if (event.type === "stroke_end") {
    const stroke = structuredClone(event.stroke);
    if (strokes.some((existing) => existing.id === stroke.id)) return state;
    if (!state.problems.some((problem) => problem.id === stroke.problemId)) throw new Error("Unknown problem");
    stroke.rowId ??= assignRow(stroke, rows);
    if (!rows.some((row) => row.id === stroke.rowId && row.problemId === stroke.problemId)) throw new Error("Unknown row");
    event = { ...event, stroke };
    strokes = [...strokes, stroke];
    rows = ensureRows(rows, strokes);
    if (stroke.tool === "pen" && stroke.erasedAt === undefined) {
      undoStack = [...undoStack, { kind: "draw", strokeIds: [stroke.id], rowId: stroke.rowId }];
      redoStack = [];
    }
  } else if (event.type === "erase" || event.type === "undo") {
    const ids = new Set(event.strokeIds);
    const rowId = event.rowId;
    const row = rows.find((row) => row.id === rowId);
    const affected = strokes.filter((stroke) => ids.has(stroke.id));
    if (!row || !ids.size || ids.size !== event.strokeIds.length || affected.length !== ids.size
      || affected.some((stroke) => stroke.rowId !== row.id || stroke.problemId !== row.problemId || stroke.tool !== "pen")) {
      throw new Error("Invalid edit targets");
    }
    let erase = true;
    if (event.type === "erase") {
      if (affected.some((stroke) => stroke.erasedAt !== undefined)) throw new Error("Stroke already erased");
      undoStack = [...undoStack, { kind: "erase", strokeIds: [...event.strokeIds], rowId: event.rowId }];
      redoStack = [];
    } else {
      const redo = event.redo === true;
      const edit = (redo ? redoStack : undoStack).at(-1);
      if (!edit || edit.rowId !== event.rowId || edit.strokeIds.length !== ids.size || edit.strokeIds.some((id) => !ids.has(id))) {
        throw new Error("Invalid undo/redo action");
      }
      erase = redo ? edit.kind === "erase" : edit.kind === "draw";
      if (redo) { redoStack = redoStack.slice(0, -1); undoStack = [...undoStack, edit]; }
      else { undoStack = undoStack.slice(0, -1); redoStack = [...redoStack, edit]; }
    }
    const at = event.at;
    strokes = strokes.map((stroke) => {
      if (!ids.has(stroke.id)) return stroke;
      if (erase) return { ...stroke, erasedAt: at };
      const restored = { ...stroke };
      delete restored.erasedAt;
      return restored;
    });
  }
  return { ...state, strokes, rows, undoStack, redoStack, events: [...state.events, structuredClone(event)],
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
