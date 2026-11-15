import { PAGE, type CanvasLayout, type Cluster, type Row, type SessionEvent, type SessionRecording, type Stroke, type StuckSignal } from "../contracts";
import { assignPageLine, pageRows } from "./pdf-pages";
import { clusterRow } from "./clusters";
import { assignLine, lineRows } from "./lines";
import { assignRow, createRows, ensureRows } from "./rows";
import { crossOutClusterIds } from "./stuck";

type Edit = { kind: "draw" | "erase"; strokeIds: string[]; rowId: string };

export type SessionState = {
  worksheetId: string;
  /** "ruled": fixed bands (P2.2). "free": rows are lines inferred from ink (P2.5a). */
  layout: CanvasLayout;
  surface?: "pdf";
  fileId?: string;
  problems: SessionRecording["problems"];
  rows: Row[];
  strokes: Stroke[];
  /** Clusters per row id, recomputed only for rows whose strokes changed. Derived, never exported. */
  clusters: Record<string, Cluster[]>;
  /** Derived once per stroke against earlier clusters; replay reconstructs the same tags. */
  crossOuts: Record<string, string[]>;
  /** One visible, untapped offer per problem. Recorded stuck events remain after dismissal. */
  stuckMarks: Record<string, StuckSignal>;
  events: SessionEvent[];
  durationMs: number;
  undoStack: Edit[];
  redoStack: Edit[];
  notes?: string;
};

/** In the free layout rows derive from strokes, so any given rows are ignored. */
export function createSessionState(problems: string[] | SessionRecording["problems"], worksheetId = "demo", rows?: Row[], layout: CanvasLayout = "ruled"): SessionState {
  const metadata = problems.map((problem) => typeof problem === "string"
    ? { id: problem, label: problem, statementLatex: "" } : { ...problem });
  const initial = layout === "free" ? [] : rows ? structuredClone(rows) : metadata.flatMap(({ id }) => createRows(id));
  return { worksheetId, layout, problems: metadata, rows: initial,
    strokes: [], clusters: {}, crossOuts: {}, stuckMarks: {}, events: [], durationMs: 0, undoStack: [], redoStack: [] };
}

/** Preserve stable empty question contexts while real line geometry continues to derive only from ink. */
function withQuestionRows(state: SessionState, inferred: Row[]): Row[] {
  const rows = [...inferred];
  for (const event of state.events) {
    if (event.type !== "hint_requested" || event.question === undefined || !event.problemId || rows.some(r => r.id === event.rowId)) continue;
    if (!state.problems.some(p => p.id === event.problemId)) throw new Error("Unknown question problem");
    const page = state.surface === "pdf" ? event.page : undefined;
    if (state.surface === "pdf" && page === undefined) throw new Error("PDF question requires a page");
    const index = Math.max(0, ...rows.filter(r => r.problemId === event.problemId && r.page === page).map(r => r.index)) + 1;
    rows.push({ id: event.rowId, problemId: event.problemId, ...(page === undefined ? {} : { page }), index,
      bbox: page === undefined ? { x: PAGE.studentCol.x, y: PAGE.statementMinHeight, w: PAGE.studentCol.w, h: PAGE.rowHeight }
        : { x: 0, y: 0, w: PAGE.width, h: 0 } });
  }
  return rows;
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
  const symbols = after.strokes.filter((stroke) => !after.crossOuts[stroke.id]);
  for (const rowId of rows) clusters[rowId] = clusterRow(symbols, rowId);
  return { ...after, clusters };
}

/** Stroke-level effect of one event: rows, erase/undo/redo (P2.4). */
function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  let strokes = state.strokes;
  let rows = state.rows;
  let undoStack = state.undoStack;
  let redoStack = state.redoStack;
  let crossOuts = state.crossOuts;
  const stuckMarks = { ...state.stuckMarks };
  if (event.type === "stroke_end") {
    const stroke = structuredClone(event.stroke);
    if (strokes.some((existing) => existing.id === stroke.id)) return state;
    if (!state.problems.some((problem) => problem.id === stroke.problemId)) throw new Error("Unknown problem");
    if (state.layout === "free") {
      if (state.surface === "pdf" && !stroke.page) throw new Error("PDF stroke requires a page");
      stroke.rowId ??= state.surface === "pdf" ? assignPageLine(stroke, strokes) : assignLine(stroke, strokes);
      rows = state.surface === "pdf" ? pageRows(state.problems.map(({ id }) => id), [...strokes, stroke])
        : lineRows(state.problems.map(({ id }) => id), [...strokes, stroke]);
    } else stroke.rowId ??= assignRow(stroke, rows);
    if (!rows.some((row) => row.id === stroke.rowId && row.problemId === stroke.problemId && row.page === stroke.page)) throw new Error("Unknown row");
    event = { ...event, stroke };
    const crossed = crossOutClusterIds(stroke, state.clusters[stroke.rowId] ?? []);
    if (crossed.length) crossOuts = { ...crossOuts, [stroke.id]: crossed };
    strokes = [...strokes, stroke];
    if (state.layout === "ruled") rows = ensureRows(rows, strokes);
    if (stroke.tool === "pen" && stroke.erasedAt === undefined) {
      delete stuckMarks[stroke.problemId];
      undoStack = [...undoStack, { kind: "draw", strokeIds: [stroke.id], rowId: stroke.rowId }];
      redoStack = state.surface === "pdf" ? redoStack.filter(edit => rows.find(r => r.id === edit.rowId)?.page !== rows.find(r => r.id === stroke.rowId)?.page) : [];
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
      redoStack = state.surface === "pdf" ? redoStack.filter(edit => rows.find(r => r.id === edit.rowId)?.page !== row.page) : [];
    } else {
      const redo = event.redo === true;
      const stack = redo ? redoStack : undoStack;
      const index = state.surface === "pdf" ? stack.findLastIndex(edit => rows.find(r => r.id === edit.rowId)?.page === row.page) : stack.length - 1;
      const edit = stack[index];
      if (!edit || edit.rowId !== event.rowId || edit.strokeIds.length !== ids.size || edit.strokeIds.some((id) => !ids.has(id))) {
        throw new Error("Invalid undo/redo action");
      }
      erase = redo ? edit.kind === "erase" : edit.kind === "draw";
      if (redo) { redoStack = redoStack.filter((_, i) => i !== index); undoStack = [...undoStack, edit]; }
      else { undoStack = undoStack.filter((_, i) => i !== index); redoStack = [...redoStack, edit]; }
    }
    const at = event.at;
    strokes = strokes.map((stroke) => {
      if (!ids.has(stroke.id)) return stroke;
      if (erase) return { ...stroke, erasedAt: at };
      const restored = { ...stroke };
      delete restored.erasedAt;
      return restored;
    });
  } else if (event.type === "stuck") {
    const signal = event.signal;
    if (!rows.some((row) => row.id === signal.rowId && row.problemId === signal.problemId)) throw new Error("Unknown stuck row");
    stuckMarks[signal.problemId] = structuredClone(signal);
  } else if (event.type === "hint_requested") {
    const rowId = event.rowId;
    if (event.question !== undefined && event.problemId) {
      const existing = rows.find(r => r.id === rowId);
      if (existing && (existing.problemId !== event.problemId || (state.surface === "pdf" && existing.page !== event.page))) throw new Error("Question context mismatch");
      rows = withQuestionRows({ ...state, events: [...state.events, event] }, rows);
    }
    const problemId = rows.find((row) => row.id === rowId)?.problemId;
    if (problemId) delete stuckMarks[problemId];
  } else if (event.type === "check_result" && event.verdict === "correct") delete stuckMarks[event.problemId];
  return { ...state, strokes, rows, undoStack, redoStack, crossOuts, stuckMarks, events: [...state.events, structuredClone(event)],
    durationMs: Math.max(state.durationMs, event.at) };
}

/** Both live completion and replay enter here. Recorded associations stay authoritative. */
export function reduceSessionEvent(state: SessionState, event: SessionEvent): SessionState {
  let next = applySessionEvent(state, event);
  if (next === state) return state;
  if (next.layout === "free" && next.strokes !== state.strokes) {
    const inferred = next.surface === "pdf" ? pageRows(next.problems.map(({ id }) => id), next.strokes) : lineRows(next.problems.map(({ id }) => id), next.strokes);
    next = { ...next, rows: withQuestionRows(next, inferred) };
  }
  return reclusterChanged(state, next);
}

/** The block supplies identity; capture's draft is never mutated. No clocks or IO. */
export function addCompletedStroke(state: SessionState, problemId: string, captured: Stroke): SessionState {
  return reduceSessionEvent(state, { type: "stroke_end", at: captured.t1, stroke: { ...captured, problemId, rowId: null } });
}
