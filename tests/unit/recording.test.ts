import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGE, SessionRecordingSchema, type SessionEvent, type Stroke } from "../../src/lib/contracts";
import { addCompletedStroke, createSessionState, reduceSessionEvent } from "../../src/lib/canvas/store";
import { exportRecording, parseRecording, Replayer } from "../../src/lib/canvas/recording";

const problems = [
  { id: "worksheet/p1", label: "1", statementLatex: "First statement" },
  { id: "worksheet/p2", label: "2a", statementLatex: "Second statement" },
];
function stroke(id: string, row: number, at: number): Stroke {
  const y = PAGE.statementMinHeight + (row - 1) * PAGE.rowHeight + 25;
  return { id, problemId: "draft", rowId: null, tool: "pen", pointerType: "pen",
    points: [{ x: 80, y, t: at - 100, p: 0.7 }, { x: 140, y: y + 10, t: at, p: 0.8 }],
    t0: at - 100, t1: at, bbox: { x: 80, y, w: 60, h: 10 } };
}
function written() {
  let state = createSessionState(problems, "worksheet");
  state = addCompletedStroke(state, problems[0]!.id, stroke("st_one", 4, 1000));
  state = addCompletedStroke(state, problems[1]!.id, stroke("st_two", 4, 8000));
  return addCompletedStroke(state, problems[0]!.id, stroke("st_three", 5, 8500));
}
afterEach(() => vi.useRealTimers());

describe("recording (P2.3-AC1/AC2)", () => {
  it("exports then instantly replays identical strokes, metadata and growing rows for both problems", () => {
    const original = written();
    const rec = exportRecording(original, "round-trip");
    expect(SessionRecordingSchema.safeParse(rec).success).toBe(true);
    let state = createSessionState(rec.problems, rec.worksheetId, rec.rows);
    new Replayer(rec, (event) => { state = reduceSessionEvent(state, event); }).seek(rec.durationMs);
    expect(state.strokes).toEqual(original.strokes);
    expect(state.events).toEqual(original.events);
    expect(state.rows).toEqual(original.rows);
    expect(state.problems).toEqual(problems);
    expect(state.worksheetId).toBe("worksheet");
    expect(state.rows.filter((row) => row.problemId === problems[0]!.id)).toHaveLength(6);
    expect(state.rows.filter((row) => row.problemId === problems[1]!.id)).toHaveLength(5);
    expect(rec.events.map((event) => event.at)).toEqual([1000, 8000, 8500]);
    expect(original.events[0]).toEqual({ type: "stroke_end", at: 1000, stroke: original.strokes[0] });
    rec.events.length = 0;
    expect(original.events).toHaveLength(3);
  });

  it("delivers an 8000ms event at 2000ms at 4x", async () => {
    vi.useFakeTimers();
    const rec = exportRecording(written(), "timing");
    const events: SessionEvent[] = [];
    const done = new Replayer(rec, (event) => events.push(event), { speed: 4 }).play();
    await vi.advanceTimersByTimeAsync(1999);
    expect(events.map((event) => event.at)).toEqual([1000]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events.map((event) => event.at)).toEqual([1000, 8000]);
    await vi.runAllTimersAsync();
    await done;
    expect(events).toEqual(rec.events);
  });

  it("preserves recorded row associations instead of recomputing them from points", () => {
    const rec = exportRecording(written(), "rows");
    const first = rec.events[0];
    if (first?.type !== "stroke_end") throw new Error("missing stroke");
    first.stroke.rowId = `${problems[0]!.id}/r2`;
    let state = createSessionState(rec.problems, rec.worksheetId, rec.rows);
    new Replayer(rec, (event) => { state = reduceSessionEvent(state, event); }).seek(Infinity);
    expect(state.strokes[0]!.rowId).toBe(first.stroke.rowId);
  });

  it("replaces playback, cancels pending timers and settles the previous play promise", async () => {
    vi.useFakeTimers();
    const rec = exportRecording(written(), "replace");
    let state = createSessionState(rec.problems, rec.worksheetId, rec.rows);
    const reset = () => { state = createSessionState(rec.problems, rec.worksheetId, rec.rows); };
    const sink = (event: SessionEvent) => { state = reduceSessionEvent(state, event); };
    const old = new Replayer(rec, sink);
    const pending = old.play();
    await vi.advanceTimersByTimeAsync(1000);
    old.cancel();
    await pending;
    reset();
    const replacement = new Replayer(rec, sink, { reset });
    replacement.seek(Infinity);
    replacement.seek(Infinity);
    await vi.runAllTimersAsync();
    expect(state.strokes).toEqual(written().strokes);
    expect(state.events).toHaveLength(3);
    replacement.seek(1000);
    expect(state.strokes).toHaveLength(1);
    const resumed = replacement.play();
    await vi.runAllTimersAsync();
    await resumed;
    expect(state.strokes).toEqual(written().strokes);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid playback speed %s", (speed) => {
    expect(() => new Replayer(exportRecording(written(), "bad-speed"), () => {}, { speed })).toThrow();
  });

  it("rejects a failed sink and leaves no scheduled playback", async () => {
    vi.useFakeTimers();
    const player = new Replayer(exportRecording(written(), "sink-error"), () => { throw new Error("sink failed"); });
    const done = expect(player.play()).rejects.toThrow("sink failed");
    await vi.runAllTimersAsync();
    await done;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("can cancel from the sink without scheduling the next event", async () => {
    vi.useFakeTimers();
    const events: SessionEvent[] = [];
    const player = new Replayer(exportRecording(written(), "stop"), (event) => { events.push(event); player.cancel(); });
    const done = player.play();
    await vi.runAllTimersAsync();
    await done;
    expect(events).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("validates imports before replacing any state", () => {
    const valid = exportRecording(written(), "valid");
    expect(parseRecording(valid)).toEqual(valid);
    const cases: unknown[] = [null, {}, { ...valid, version: 2 }, { ...valid, durationMs: -1 },
      { ...valid, events: [{ type: "stroke_end", at: 0, stroke: {} }] },
      { ...valid, events: [...valid.events].reverse() }, { ...valid, durationMs: 1 },
      { ...valid, problems: [problems[0]] }, { ...valid, rows: [] },
      { ...valid, events: [valid.events[0], valid.events[0]] }];
    for (const input of cases) expect(() => parseRecording(input)).toThrow();
  });
});
