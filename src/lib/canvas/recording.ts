import { SessionRecordingSchema, type SessionEvent, type SessionRecording } from "../contracts";
import { createSessionState, reduceSessionEvent, type SessionState } from "./store";

/** Schema validation plus relationships/order required to replay without dropping data. No IO. */
export function parseRecording(input: unknown): SessionRecording {
  const rec = SessionRecordingSchema.parse(input);
  const invalid = () => { throw new Error("Invalid recording relationships or timing"); };
  const problems = new Set(rec.problems.map(({ id }) => id));
  const rows = new Map(rec.rows.map((row) => [row.id, row]));
  if (problems.size !== rec.problems.length || rows.size !== rec.rows.length) invalid();
  for (const row of rec.rows) if (!problems.has(row.problemId) || (rec.surface === "pdf" && row.page === undefined)) invalid();
  const layout = rec.layout ?? "ruled";
  // Ruled problems always have bands; free-layout rows exist only where there is ink.
  if (layout === "ruled") for (const id of problems) if (!rec.rows.some((row) => row.problemId === id)) invalid();
  const strokes = new Set<string>();
  let previous = 0;
  let state = createSessionState(rec.problems, rec.worksheetId, rec.rows, layout);
  for (const event of rec.events) {
    if (event.at < previous || event.at > rec.durationMs) invalid();
    previous = event.at;
    state = reduceSessionEvent(state, event);
    if (event.type !== "stroke_end") continue;
    const stroke = event.stroke;
    if (strokes.has(stroke.id) || !problems.has(stroke.problemId)
      || (rec.surface === "pdf" && stroke.page === undefined)
      || !stroke.rowId || rows.get(stroke.rowId)?.problemId !== stroke.problemId || rows.get(stroke.rowId)?.page !== stroke.page
      || stroke.t0 !== stroke.points[0]?.t || stroke.t1 !== stroke.points.at(-1)?.t
      || stroke.t1 > event.at) invalid();
    strokes.add(stroke.id);
    let time = stroke.t0;
    for (const point of stroke.points) {
      if (point.t < time) invalid();
      time = point.t;
    }
  }
  return rec;
}

/** Snapshot only; the caller supplies elapsed time in state, never a clock here. */
export function exportRecording(state: SessionState, name: string): SessionRecording {
  return parseRecording({ version: 1, name, worksheetId: state.worksheetId, problems: state.problems,
    rows: state.rows, events: state.events, durationMs: state.durationMs,
    ...(state.surface === "pdf" ? { surface: "pdf", fileId: state.fileId } : {}),
    ...(state.notes === undefined ? {} : { notes: state.notes }),
    ...(state.layout === "free" ? { layout: "free" as const } : {}) });
}

type ReplayOptions = { speed?: number; reset?: () => void };

/** Timer adapter around the original event timeline. cancel() settles pending play(). */
export class Replayer {
  private readonly rec: SessionRecording;
  private readonly speed: number;
  private cursor = 0;
  private position = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settle: (() => void) | undefined;
  private generation = 0;

  constructor(rec: SessionRecording, private readonly sink: (event: SessionEvent) => void, private readonly opts: ReplayOptions = {}) {
    this.rec = parseRecording(rec);
    this.speed = opts.speed ?? 1;
    if (!Number.isFinite(this.speed) || this.speed <= 0) throw new Error("Playback speed must be positive and finite");
  }

  cancel(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.settle?.();
    this.settle = undefined;
  }

  play(): Promise<void> {
    this.cancel();
    const generation = this.generation;
    const started = Date.now();
    const from = this.position;
    return new Promise((resolve, reject) => {
      this.settle = resolve;
      const next = () => {
        const event = this.rec.events[this.cursor];
        const target = event?.at ?? this.rec.durationMs;
        this.timer = setTimeout(() => {
          if (generation !== this.generation) return;
          this.position = target;
          if (!event) { this.cancel(); return; }
          try { this.sink(structuredClone(event)); }
          catch (error) { this.settle = undefined; this.cancel(); reject(error); return; }
          if (generation !== this.generation) return;
          this.cursor++;
          next();
        }, Math.max(0, (target - from) / this.speed - (Date.now() - started)));
      };
      next();
    });
  }

  /** Forward seeks emit the remaining prefix. Supply reset to support backward/repeated seeks. */
  seek(ms: number): void {
    if (Number.isNaN(ms) || ms < 0) throw new Error("Seek time must be nonnegative");
    this.cancel();
    const target = Math.min(ms, this.rec.durationMs);
    if (this.opts.reset) {
      this.opts.reset();
      this.cursor = 0;
    } else if (target < this.position) throw new Error("Backward seek needs a reset sink");
    while (this.cursor < this.rec.events.length && this.rec.events[this.cursor]!.at <= target) {
      this.sink(structuredClone(this.rec.events[this.cursor++]!));
    }
    this.position = target;
  }
}
