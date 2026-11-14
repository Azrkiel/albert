import { describe, expect, it } from "vitest";
import { parseHintChunk, type HintParserState } from "../../src/lib/tutor/client";

const initial = (): HintParserState => ({ buffer: "", events: [], status: "streaming" });
const started = { type: "started", hintId: "h1", at: 0 };
const hint = { type: "hint", kind: "question", segments: [{ type: "text", text: "What becomes of dx?" }] };
const done = { type: "done", hintId: "h1", ms: { firstEvent: 1, total: 2 } };
const line = (event: unknown) => JSON.stringify(event) + "\n";

describe("hint client NDJSON parser", () => {
  it("handles a line split across chunks without emitting it early", () => {
    const text = line(started);
    const previous = initial();
    const first = parseHintChunk(previous, text.slice(0, 12));
    expect(first.events).toEqual([]);
    const second = parseHintChunk(first, text.slice(12));
    expect(second.events).toEqual([started]);
    expect(second.status).toBe("streaming");
    expect(previous).toEqual(initial());
    expect(first.buffer).toBe(text.slice(0, 12));
  });
  it("handles several lines in one chunk and exposes hint before done", () => {
    const first = parseHintChunk(initial(), line(started) + line(hint));
    expect(first.events).toEqual([started, hint]);
    expect(first.status).toBe("streaming");
    expect(parseHintChunk(first, line(done)).status).toBe("done");
  });
  it("handles a final line without a newline", () => {
    const state = parseHintChunk(initial(), line(started) + JSON.stringify(done), true);
    expect(state.events).toEqual([started, done]);
    expect(state.status).toBe("done");
    expect(state.buffer).toBe("");
  });
  it.each(["bad JSON", '{}', '{"type":"done"}'])("turns a bad line %j into an error state", (bad) => {
    const state = parseHintChunk(initial(), line(started) + bad + "\n");
    expect(state.status).toBe("error");
    expect(state.events[0]).toEqual(started);
    expect(state.events.at(-1)).toMatchObject({ type: "error", code: "bad_model_output" });
  });
  it("handles an error event without crashing or accepting later events", () => {
    const error = { type: "error", code: "timeout", message: "Try again." };
    const state = parseHintChunk(initial(), line(error) + line(done));
    expect(state.events).toEqual([error]);
    expect(state.status).toBe("error");
    expect(parseHintChunk(state, line(done))).toBe(state);
  });
  it("reports a truncated stream instead of marking it done", () => {
    expect(parseHintChunk(initial(), line(started), true).status).toBe("error");
  });
  it("handles CRLF and blank lines", () => {
    const state = parseHintChunk(initial(), '\r\n' + JSON.stringify(done) + '\r\n', true);
    expect(state.events).toEqual([done]);
    expect(state.status).toBe("done");
  });
});
