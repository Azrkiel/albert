import { HintRequestSchema, type HintRequest, type HintTurn, type InkSegment, type Rung, type SessionEvent, type StuckSignal } from "../contracts";
import { renderSnapshot, type Snapshot, type SnapshotArgs } from "./snapshot";
import { listClusters, type SessionState } from "./store";

export type BuildHintRequestOptions = {
  /**
   * `SessionState` has no session id until P2.8 (session sync) adds one. Until then callers may pass
   * their own; the default is the local placeholder `local:<worksheetId>`. P2.8 replaces it.
   */
  sessionId?: string;
  /** Omitted for legacy worksheet callers. */
  problemSource?: HintRequest["problemSource"];
  /** Also render image.clean. General handwriting includes it by default to keep labels out of transcription. */
  clean?: boolean;
  question?: string;
  background?: SnapshotArgs["background"];
  /** Injected in unit tests, which have no canvas. */
  render?: (args: SnapshotArgs) => Promise<Snapshot>;
};

export function localSessionId(worksheetId: string): string {
  return `local:${worksheetId}`;
}

function segmentsText(segments: InkSegment[]): string {
  return segments.map((s) => s.type === "text" ? s.text : s.type === "math" ? `$${s.latex}$` : "\n").join("");
}

/**
 * Earlier hints on this problem, oldest first, from `hint_shown` events. Rung and row come from the
 * matching `hint_requested` event (falling back to rung 1 and the hint's written row); the text is the
 * hint's written segments; `studentWroteAfter` is any later pen stroke on the same problem.
 */
export function hintHistory(events: SessionEvent[], problemId: string, rowProblem: (rowId: string) => string | undefined): HintTurn[] {
  const requested = new Map<string, Extract<SessionEvent, { type: "hint_requested" }>>();
  for (const event of events) if (event.type === "hint_requested") requested.set(event.hintId, event);
  const turns: HintTurn[] = [];
  const shown = events.filter((e): e is Extract<SessionEvent, { type: "hint_shown" }> => e.type === "hint_shown")
    .sort((a, b) => a.at - b.at);
  for (const event of shown) {
    const request = requested.get(event.hintId);
    const writing = event.marks.flatMap((mark) => mark.spec.type === "writing" ? [mark.spec] : []);
    const onProblem = event.marks.some((mark) => mark.problemId === problemId)
      || (request !== undefined && rowProblem(request.rowId) === problemId);
    if (!onProblem) continue;
    const rowId = request?.rowId ?? writing[0]?.rowId;
    if (rowId === undefined) continue;
    turns.push({
      hintId: event.hintId,
      rung: request?.rung ?? 1,
      rowId,
      ...(request?.question === undefined ? {} : { question: request.question }),
      text: writing.map((spec) => segmentsText(spec.segments)).join("\n"),
      studentWroteAfter: events.some((e) => e.type === "stroke_end" && e.at > event.at
        && e.stroke.problemId === problemId && e.stroke.tool === "pen"),
    });
  }
  return turns;
}

/**
 * A full `HintRequest` for a stuck row: the marked snapshot of rows 1..rowId, the rows and their
 * cluster labels as drawn, and the hint history. Parsed with `HintRequestSchema` before it is returned.
 * Shared by the page's live hint flow and its dev request hook.
 */
export async function buildHintRequest(state: SessionState, rowId: string, rung: Rung, trigger: StuckSignal["kind"],
  options: BuildHintRequestOptions = {}): Promise<HintRequest> {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) throw new Error("Unknown row");
  const render = options.render ?? renderSnapshot;
  const base = { ...(options.background ? { background: options.background } : {}), strokes: state.strokes, rows: state.rows, clusters: listClusters(state), problemId: row.problemId, upToRowId: rowId };
  const marked = await render({ ...base, marked: true });
  const clean = (options.clean ?? options.problemSource === "handwriting") ? await render({ ...base, marked: false }) : undefined;
  const problemOf = (id: string) => state.rows.find((r) => r.id === id)?.problemId;
  return HintRequestSchema.parse({
    sessionId: options.sessionId ?? localSessionId(state.worksheetId),
    worksheetId: state.worksheetId,
    ...(options.problemSource === undefined ? {} : { problemSource: options.problemSource }),
    problemId: row.problemId,
    rowId,
    rung,
    trigger,
    ...(options.question === undefined ? {} : { question: options.question }),
    image: { marked: marked.png, ...(clean ? { clean: clean.png } : {}), width: marked.width, height: marked.height },
    rows: marked.rows,
    history: hintHistory(state.events, row.problemId, problemOf),
  });
}
