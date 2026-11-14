import type { Row, Stroke } from "../contracts";
import { assignRow, createRows, ensureRows } from "./rows";

// Internal state only. Event history/replay belongs to P2.3.
export type SessionState = { rows: Row[]; strokes: Stroke[] };

export function createSessionState(problemIds: string[]): SessionState {
  return { rows: problemIds.flatMap(createRows), strokes: [] };
}

/** The block supplies identity; capture's draft is never mutated. No clocks or IO. */
export function addCompletedStroke(state: SessionState, problemId: string, captured: Stroke): SessionState {
  const stroke = { ...captured, problemId };
  stroke.rowId = assignRow(stroke, state.rows);
  const strokes = [...state.strokes, stroke];
  return { strokes, rows: ensureRows(state.rows, strokes) };
}
