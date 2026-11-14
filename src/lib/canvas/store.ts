import type { Row, SessionEvent, SessionRecording, Stroke } from "../contracts";
import { assignRow, createRows, ensureRows } from "./rows";

export type SessionState = {
  worksheetId: string;
  problems: SessionRecording["problems"];
  rows: Row[];
  strokes: Stroke[];
  events: SessionEvent[];
  durationMs: number;
  notes?: string;
};

export function createSessionState(problems: string[] | SessionRecording["problems"], worksheetId = "demo", rows?: Row[]): SessionState {
  const metadata = problems.map((problem) => typeof problem === "string"
    ? { id: problem, label: problem, statementLatex: "" } : { ...problem });
  return { worksheetId, problems: metadata, rows: rows ? structuredClone(rows) : metadata.flatMap(({ id }) => createRows(id)),
    strokes: [], events: [], durationMs: 0 };
}

/** Both live completion and replay enter here. Recorded associations stay authoritative. */
export function reduceSessionEvent(state: SessionState, event: SessionEvent): SessionState {
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
  }
  return { ...state, strokes, rows, events: [...state.events, structuredClone(event)],
    durationMs: Math.max(state.durationMs, event.at) };
}

/** The block supplies identity; capture's draft is never mutated. No clocks or IO. */
export function addCompletedStroke(state: SessionState, problemId: string, captured: Stroke): SessionState {
  return reduceSessionEvent(state, { type: "stroke_end", at: captured.t1, stroke: { ...captured, problemId, rowId: null } });
}
