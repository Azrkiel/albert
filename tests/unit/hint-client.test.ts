import { describe, expect, it } from "vitest";
import { HintErrorCodeSchema, type HintEvent } from "../../src/lib/contracts";
import { createHintRunner, parseHintChunk, type HintFetch, type HintParserState } from "../../src/lib/tutor/client";
import { CLIENT_FAILURE_CODES, HINT_ERROR_NOTES, hintErrorNote, hintMarginText } from "../../src/lib/tutor/error-notes";

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

describe("P3.8 error notes", () => {
  it("maps every HintErrorCode to its plain note", () => {
    expect(HINT_ERROR_NOTES).toEqual({
      model_unavailable: "Albert can't reach his notes right now. Try again.",
      bad_model_output: "Albert couldn't read that. Try again?",
      timeout: "That took too long. Try again?",
      bad_request: "That hint didn't go through. Try again.",
    });
    for (const code of HintErrorCodeSchema.options) expect(hintErrorNote(code)).toBe(HINT_ERROR_NOTES[code]);
  });
  it.each([
    ["http_400", "bad_request"], ["http_error", "model_unavailable"], ["network", "model_unavailable"],
    ["truncated", "model_unavailable"], ["invalid_line", "bad_model_output"],
  ] as const)("maps the client failure %s to %s", (failure, code) => {
    expect(CLIENT_FAILURE_CODES[failure]).toBe(code);
  });
  it("shows the note, never the raw message, and drops partial hint text before an error", () => {
    const error = { type: "error", code: "timeout", message: "raw server text" } as const;
    expect(hintMarginText([started, hint] as HintEvent[])).toBe("What becomes of dx?");
    expect(hintMarginText([started, hint, error] as HintEvent[])).toBe("That took too long. Try again?");
  });
  it.each([
    ["an invalid line", line(started) + "bad JSON\n", false, "Albert couldn't read that. Try again?"],
    ["a truncated stream", line(started), true, "Albert can't reach his notes right now. Try again."],
  ])("parser output for %s ends in a known note", (_name, text, final, note) => {
    expect(hintMarginText(parseHintChunk(initial(), text, final).events)).toBe(note);
  });
});

type FakeCall = { signal: AbortSignal; respond: (status?: number) => void; reject: (error: Error) => void;
  push: (event: unknown) => void; end: () => void };

function fakeHintServer() {
  const calls: FakeCall[] = [];
  const encoder = new TextEncoder();
  // Deliberately ignores the abort signal, so the runner itself must drop a superseded stream.
  const fetchHint: HintFetch = (_input, init) => new Promise<Response>((resolve, reject) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    calls.push({ signal: init.signal!, reject, respond: (status = 200) => resolve(new Response(body, { status })),
      push: (event) => controller.enqueue(encoder.encode(line(event))), end: () => controller.close() });
  });
  const states: HintParserState[] = [];
  const runner = createHintRunner(fetchHint, (state) => states.push(state));
  return { calls, states, runner };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const request = () => ({ sessionId: "s", worksheetId: "w", problemId: "p", rowId: "r1", rung: 1 as const,
  trigger: "manual" as const, image: { marked: "x", width: 1, height: 1 }, rows: [], history: [] });
const second = { type: "started", hintId: "h2", at: 0 };
const secondHint = { type: "hint", kind: "question", segments: [{ type: "text", text: "Second hint?" }] };
const secondDone = { type: "done", hintId: "h2", ms: { firstEvent: 1, total: 2 } };

describe("P3.8-AC2: createHintRunner (the logic behind useHint)", () => {
  it("a second request aborts the first, and the first's late events and error never appear", async () => {
    const { calls, states, runner } = fakeHintServer();
    const first = runner.request(request());
    calls[0]!.respond();
    calls[0]!.push(started);
    await tick();
    expect(states.at(-1)?.events).toEqual([started]);

    const next = runner.request(request());
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    const seen = states.length;
    // The superseded stream keeps talking: a hint, then an error. None of it may be published.
    calls[0]!.push(hint);
    calls[0]!.push({ type: "error", hintId: "h1", code: "timeout", message: "late" });
    calls[0]!.end();
    await first;
    calls[1]!.respond();
    calls[1]!.push(second);
    calls[1]!.push(secondHint);
    calls[1]!.push(secondDone);
    calls[1]!.end();
    await next;

    const after = states.slice(seen);
    expect(after.flatMap((state) => state.events)).not.toContainEqual(hint);
    expect(after.every((state) => state.events.every((event) => event.type !== "error"))).toBe(true);
    expect(states.at(-1)).toEqual({ buffer: "", events: [second, secondHint, secondDone], status: "done" });
    expect(hintMarginText(states.at(-1)!.events)).toBe("Second hint?");
  });

  it("a first request that fails after it was superseded publishes no error note", async () => {
    const { calls, states, runner } = fakeHintServer();
    const first = runner.request(request());
    const next = runner.request(request());
    calls[0]!.reject(new DOMException("aborted", "AbortError"));
    await first;
    expect(states.every((state) => state.status !== "error")).toBe(true);
    calls[1]!.respond();
    calls[1]!.push(second);
    calls[1]!.push(secondDone);
    calls[1]!.end();
    await next;
    expect(states.at(-1)?.status).toBe("done");
  });

  it("a superseded first request whose response arrives late never publishes its body", async () => {
    const { calls, states, runner } = fakeHintServer();
    const first = runner.request(request());
    const next = runner.request(request());
    calls[1]!.respond();
    calls[1]!.push(second);
    await tick();
    calls[0]!.respond();
    calls[0]!.push(hint);
    calls[0]!.end();
    await first;
    expect(states.at(-1)?.events).toEqual([second]);
    calls[1]!.push(secondDone);
    calls[1]!.end();
    await next;
    expect(states.at(-1)?.events).toEqual([second, secondDone]);
  });

  it("dispose during a request never leaves the page streaming", async () => {
    const { calls, states, runner } = fakeHintServer();
    const pending = runner.request(request());
    calls[0]!.respond();
    calls[0]!.push(started);
    await tick();
    runner.dispose();
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(states.at(-1)?.status).toBe("idle");
    const seen = states.length;
    calls[0]!.push(hint);
    calls[0]!.end();
    await pending;
    expect(states.length).toBe(seen);
  });

  it("cancel stops publishing and leaves the runner usable", async () => {
    const { calls, states, runner } = fakeHintServer();
    const first = runner.request(request());
    calls[0]!.respond();
    runner.cancel();
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(states.at(-1)?.status).toBe("idle");
    const seen = states.length;
    calls[0]!.push(hint);
    calls[0]!.end();
    await first;
    expect(states.length).toBe(seen);
    const next = runner.request(request());
    calls[1]!.respond();
    calls[1]!.push(second);
    calls[1]!.push(secondDone);
    calls[1]!.end();
    await next;
    expect(states.at(-1)?.status).toBe("done");
  });

  it.each([
    [400, "That hint didn't go through. Try again."],
    [503, "Albert can't reach his notes right now. Try again."],
  ])("a %i response ends in its note", async (status, note) => {
    const { calls, states, runner } = fakeHintServer();
    const pending = runner.request(request());
    calls[0]!.respond(status);
    await pending;
    expect(states.at(-1)?.status).toBe("error");
    expect(hintMarginText(states.at(-1)!.events)).toBe(note);
  });

  it("a network failure ends in the model_unavailable note", async () => {
    const { calls, states, runner } = fakeHintServer();
    const pending = runner.request(request());
    calls[0]!.reject(new TypeError("Failed to fetch"));
    await pending;
    expect(hintMarginText(states.at(-1)!.events)).toBe("Albert can't reach his notes right now. Try again.");
  });
});
