import { readFileSync } from "node:fs";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatBedrockConverse } from "@langchain/aws";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintEventSchema, HintRequestSchema, StoredHintSchema, type AlbertReply, type HintEvent } from "../../src/lib/contracts";
import { MemoryRepo, seedDemo } from "../../src/lib/db";
import { runHint, type HintDeps, type HintModel } from "../../src/lib/tutor/hint";
import { buildMessages } from "../../src/lib/tutor/prompt";
import { getScopeBundle } from "../../src/lib/tutor/scope";
import { albertReplyTool, getHintModel } from "../../src/lib/tutor/tools";

const request = HintRequestSchema.parse(JSON.parse(readFileSync("fixtures/eval/requests/missing-dx-r1.json", "utf8")));
const privateNote = "PRIVATE_ONLY_missing_differential";
const valid = (): AlbertReply => ({
  reading: { rows: request.rows.map((row) => ({ index: row.index, latex: "x", confidence: "high" })) },
  diagnosis: { status: "error", rowIndex: 3, clusterLabels: [1, 99], errorType: "missing_dx", subskillId: "u3.find_dx", privateNote },
  marks: [{ type: "circle", rowIndex: 3, clusterLabels: [1] }],
  hint: { kind: "question", segments: [{ type: "text", text: "What does dx become?" }], citation: { unitId: "calc2/u3", label: "Lecture 9, Example 2" } },
});
const response = (args: AlbertReply) => new AIMessage({ content: "", tool_calls: [{ name: "albert_reply", args, id: "call1", type: "tool_call" }] });
const collect = async (deps: HintDeps, req = request) => {
  const events: HintEvent[] = [];
  for await (const event of runHint(req, deps)) {
    HintEventSchema.parse(event);
    events.push(event); // Assert privacy against raw events, before zod can strip fields.
  }
  return events;
};
let repo: MemoryRepo;
beforeEach(async () => { repo = new MemoryRepo(); await seedDemo(repo); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("P3.3 runHint", () => {
  it("emits the event order, saves a valid StoredHint with privateNote, and never streams it (AC5)", async () => {
    let now = Date.parse("2026-11-14T16:00:00Z");
    const invoke = vi.fn(async () => { now += 100; return response(valid()); });
    const events = await collect({ model: { invoke }, repo, clock: () => now++ });
    expect(events.map((event) => event.type)).toEqual(["started", "reading", "diagnosis", "mark", "hint", "done"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events)).not.toContain(privateNote);
    expect(events[2]).toMatchObject({ status: "error", rowId: request.rowId, clusterIds: [`${request.rowId}/c1`], inScope: true });
    const stored = StoredHintSchema.parse((await repo.listHints({ sessionId: request.sessionId }))[0]);
    expect(stored).toMatchObject({ sessionId: request.sessionId, courseId: "calc2", problemId: request.problemId, rowId: request.rowId, rung: 1, diagnose: valid().diagnosis });
    expect(stored.ms.firstEvent).toBeGreaterThanOrEqual(100);
    expect(stored.ms.total).toBeGreaterThanOrEqual(stored.ms.firstEvent);
    expect(events.at(-1)).toEqual({ type: "done", hintId: stored.id, ms: stored.ms });
  });
  it("AC2: cluster 99 becomes a whole-row mark for both circle and arrow", async () => {
    const reply = valid();
    reply.marks = [{ type: "circle", rowIndex: 3, clusterLabels: [99] }, { type: "arrow", fromHint: true, toRowIndex: 3, toClusterLabels: [99] }];
    const events = await collect({ model: { invoke: async () => response(reply) }, repo });
    expect(events.filter((event) => event.type === "mark").map((event) => event.mark)).toEqual([
      { type: "circle", rowId: request.rowId, clusterIds: [] }, { type: "arrow", toRowId: request.rowId, toClusterIds: [] },
    ]);
  });
  it("drops unknown labels, retains known labels, and deduplicates them", async () => {
    const reply = valid();
    reply.marks = [{ type: "underline", rowIndex: 3, clusterLabels: [99, 2, 2, 1] }];
    expect((await collect({ model: { invoke: async () => response(reply) }, repo })).find((event) => event.type === "mark"))
      .toEqual({ type: "mark", mark: { type: "underline", rowId: request.rowId, clusterIds: [`${request.rowId}/c2`, `${request.rowId}/c1`] } });
  });
  it("AC4: retries an over-long rung 1 once with violation text, then emits one hint and no error", async () => {
    const bad = valid();
    bad.hint.segments = [{ type: "text", text: `${"word ".repeat(29)}word?` }];
    const prompts: BaseMessage[][] = [];
    const invoke = vi.fn(async (messages: BaseMessage[]) => {
      prompts.push([...messages]);
      return response(prompts.length === 1 ? bad : valid());
    });
    const events = await collect({ model: { invoke }, repo });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "hint")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(JSON.stringify(prompts[1])).toContain("at most 18 words; you used 30");
    expect(prompts[0]).toHaveLength(2);
  });
  it("two rule failures give only one bad_model_output, no persisted hint", async () => {
    const reply = valid(); reply.hint.segments = [{ type: "text", text: "No question mark" }];
    const invoke = vi.fn(async () => response(reply));
    expect(await collect({ model: { invoke }, repo })).toEqual([
      expect.objectContaining({ type: "error", code: "bad_model_output" }),
    ]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(await repo.listHints({})).toEqual([]);
  });
  it.each([
    { tool_calls: [] },
    { tool_calls: [{ name: "other", args: valid() }] },
    { tool_calls: [{ name: "albert_reply", args: { ...valid(), hint: null } }] },
    { tool_calls: [1, 2].map(() => ({ name: "albert_reply", args: valid() })) },
    { tool_calls: [{ name: "albert_reply", args: valid() }], invalid_tool_calls: [{ name: "extra", args: "{" }] },
  ])("rejects malformed or multiple tool replies and repairs once", async (badOutput) => {
    let calls = 0;
    const model: HintModel = { invoke: async () => ++calls === 1 ? badOutput : response(valid()) };
    expect((await collect({ model, repo })).at(-1)?.type).toBe("done");
    expect(calls).toBe(2);
  });
  it("two parse failures give one bad_model_output", async () => {
    const invoke = vi.fn(async () => ({ tool_calls: [] }));
    const events = await collect({ model: { invoke }, repo });
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "bad_model_output" })]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("times out and aborts a provider that never settles, without saving or leaking partial work", async () => {
    vi.useFakeTimers(); vi.stubEnv("HINT_TIMEOUT_MS", "200");
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    let signal: AbortSignal | undefined;
    const model: HintModel = { invoke: async (_messages, options) => { signal = options.signal; return new Promise(() => {}); } };
    const pending = collect({ model, repo, scopeLoader: async () => scope });
    await vi.advanceTimersByTimeAsync(201);
    expect(await pending).toEqual([expect.objectContaining({ type: "error", code: "timeout" })]);
    expect(signal?.aborted).toBe(true);
    expect(await repo.listHints({})).toEqual([]);
  });
  it("uses one deadline across the retry", async () => {
    vi.useFakeTimers(); vi.stubEnv("HINT_TIMEOUT_MS", "200");
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    const bad = valid(); bad.hint.kind = "worked_step";
    const invoke = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); return response(bad); });
    const pending = collect({ model: { invoke }, repo, scopeLoader: async () => scope });
    await vi.advanceTimersByTimeAsync(201);
    expect(await pending).toEqual([expect.objectContaining({ type: "error", code: "timeout" })]);
    expect(invoke).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(await repo.listHints({})).toEqual([]);
  });
  it("returns a generic model_unavailable on transport errors, without a repair or exception details", async () => {
    const invoke = vi.fn(async () => { throw new Error(privateNote); });
    const events = await collect({ model: { invoke }, repo });
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "model_unavailable" })]);
    expect(JSON.stringify(events)).not.toContain(privateNote);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves P7.1 evidence integration and saves the full diagnosis exactly once", async () => {
    await repo.createSession({ id: request.sessionId, studentId: "demo", courseId: "calc2", worksheetId: request.worksheetId, startedAt: new Date().toISOString() });
    const save = vi.spyOn(repo, "saveHint");
    await collect({ model: { invoke: async () => response(valid()) }, repo });
    expect(save).toHaveBeenCalledTimes(1);
    expect((await repo.listHints({}))[0]?.diagnose.privateNote).toBe(privateNote);
    expect(await repo.listEvidence("demo", "calc2")).toEqual([expect.objectContaining({ outcome: "error_made", errorType: "missing_dx" })]);
  });
  it("unreadable yields reread, no marks and no evidence even at rung 3", async () => {
    const reply = valid(); reply.diagnosis.status = "unreadable"; reply.marks = [];
    reply.hint = { kind: "reread", segments: [{ type: "text", text: "Please rewrite the last row." }] };
    const events = await collect({ model: { invoke: async () => response(reply) }, repo }, { ...request, rung: 3 });
    expect(events.filter((event) => event.type === "hint")).toEqual([expect.objectContaining({ kind: "reread" })]);
    expect(events.filter((event) => event.type === "mark")).toEqual([]);
    expect(await repo.listEvidence("demo", "calc2")).toEqual([]);
  });
});

describe("P3.8 server failure behaviour", () => {
  const noNotes = "Your notes for this unit aren't posted yet, so I can't tell how your teacher does this.";
  const logRequest = { ...request, image: { ...request.image, marked: "SECRET_IMAGE", clean: "SECRET_CLEAN_IMAGE" } };
  function expectLog(log: ReturnType<typeof vi.fn>, events: HintEvent[], status: string, retryCount: number) {
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0];
    expect(Object.keys(line).sort()).toEqual(["case", "hintId", "ms", "retryCount", "rung", "status"]);
    const terminal = events.at(-1)!;
    expect(line).toEqual({
      hintId: expect.any(String),
      case: { worksheetId: request.worksheetId, problemId: request.problemId, rowId: request.rowId },
      status, rung: request.rung, retryCount,
      ms: terminal.type === "done" ? { firstEvent: terminal.ms.firstEvent, total: expect.any(Number) } : expect.any(Number),
    });
    expect(line.hintId).toBe("hintId" in terminal ? terminal.hintId : undefined);
    if (typeof line.ms === "number") expect(line.ms).toBeGreaterThanOrEqual(0);
    else {
      expect(line.ms.firstEvent).toBeGreaterThanOrEqual(0);
      expect(line.ms.total).toBeGreaterThanOrEqual(line.ms.firstEvent);
      if (terminal.type === "done") expect(line.ms.total).toBeGreaterThanOrEqual(terminal.ms.total);
    }
    const serialized = JSON.stringify(line);
    for (const secret of [privateNote, "privateNote", "SECRET_IMAGE", "SECRET_CLEAN_IMAGE", "You are Albert", "What does dx become?", "PROVIDER_SECRET"]) {
      expect(serialized).not.toContain(secret);
    }
  }

  it.each(["calc2/u4", "unknown-unit"])("passes only public deferral fields for %s, with a scope title only when known", async (unitId) => {
    const reply = valid();
    reply.diagnosis.easierOutOfScope = { methodName: "Partial fractions", unitId };
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    // The lookup is by unitId, not the first upcoming method or a model-provided title.
    scope.upcomingMethods = [
      { name: "Other method", unitId: "other-unit", unitTitle: "Wrong title" },
      { name: "Partial fractions", unitId: "calc2/u4", unitTitle: "Partial Fractions" },
    ];
    const events = await collect({ model: { invoke: async () => response(reply) }, repo, scopeLoader: async () => scope });
    const diagnosis = events.find((event) => event.type === "diagnosis");
    expect(diagnosis).toMatchObject({ status: "error", inScope: true });
    if (unitId === "calc2/u4") expect(diagnosis).toHaveProperty("deferredMethod", {
      name: "Partial fractions", unitId, unitTitle: "Partial Fractions",
    });
    else expect(diagnosis).not.toHaveProperty("deferredMethod");
    expect(events.at(-1)?.type).toBe("done");
    expect(JSON.stringify(events)).not.toContain(privateNote);
    expect(JSON.stringify(events)).not.toContain("privateNote");
    expect(JSON.stringify(events)).not.toContain("easierOutOfScope");
  });

  it.each([1, 2, 3] as const)("AC4: no notes at rung %s bypasses the model, stores nothing and logs once", async (rung) => {
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    scope.taught = false;
    scope.card.taught = false;
    await repo.createSession({ id: request.sessionId, studentId: "demo", courseId: "calc2", worksheetId: request.worksheetId, startedAt: new Date().toISOString() });
    const invoke = vi.fn(async () => response(valid()));
    const saveHint = vi.spyOn(repo, "saveHint");
    const addEvidence = vi.spyOn(repo, "addEvidence");
    const log = vi.fn();
    const events = await collect({ model: { invoke }, repo, scopeLoader: async () => scope, log }, { ...request, rung });
    expect(invoke).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["started", "diagnosis", "hint", "done"]);
    expect(events[1]).toEqual({ type: "diagnosis", status: "stalled", inScope: true });
    expect(events.filter((event) => event.type === "hint")).toEqual([
      { type: "hint", kind: "reread", segments: [{ type: "text", text: noNotes }] },
    ]);
    expect(events.filter((event) => event.type === "mark")).toEqual([]);
    expect(saveHint).not.toHaveBeenCalled();
    expect(addEvidence).not.toHaveBeenCalled();
    expect(await repo.listHints({})).toEqual([]);
    expect(await repo.listEvidence("demo", "calc2")).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({ status: "done", rung, retryCount: 0 });
    if (rung === 1) expectLog(log, events, "done", 0);
  });

  it.each([
    { outcome: "success", status: "done", retryCount: 0 },
    { outcome: "repair", status: "done", retryCount: 1 },
    { outcome: "invalid", status: "bad_model_output", retryCount: 1 },
    { outcome: "throws", status: "model_unavailable", retryCount: 0 },
    { outcome: "repair-throws", status: "model_unavailable", retryCount: 1 },
    { outcome: "timeout", status: "timeout", retryCount: 0 },
  ])("writes one safe log line for $outcome", async ({ outcome, status, retryCount }) => {
    vi.useFakeTimers(); vi.stubEnv("HINT_TIMEOUT_MS", "20");
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    let calls = 0;
    const invoke = vi.fn(async () => {
      calls++;
      if (outcome === "throws" || (outcome === "repair-throws" && calls === 2)) throw new Error("PROVIDER_SECRET");
      if (outcome === "timeout") return new Promise<never>(() => {});
      if (outcome === "invalid" || ((outcome === "repair" || outcome === "repair-throws") && calls === 1)) return { tool_calls: [] };
      return response(valid());
    });
    const log = vi.fn();
    const pending = collect({ model: { invoke }, repo, scopeLoader: async () => scope, log }, logRequest);
    if (outcome === "timeout") await vi.advanceTimersByTimeAsync(21);
    const events = await pending;
    expectLog(log, events, status, retryCount);
    expect(invoke).toHaveBeenCalledTimes(retryCount + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to one console.info call containing a single JSON line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const events = await collect({ model: { invoke: async () => response(valid()) }, repo }, logRequest);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toHaveLength(1);
    const serialized = info.mock.calls[0]![0] as string;
    expect(serialized).not.toContain("\n");
    const captured = vi.fn(); captured(JSON.parse(serialized));
    expectLog(captured, events, "done", 0);
  });

  it("includes persistence time in the successful log's total", async () => {
    let now = Date.parse("2026-11-14T16:00:00Z");
    const save = repo.saveHint.bind(repo);
    vi.spyOn(repo, "saveHint").mockImplementation(async (hint) => { now += 200; await save(hint); });
    const log = vi.fn();
    const events = await collect({ model: { invoke: async () => response(valid()) }, repo, clock: () => now, log });
    expectLog(log, events, "done", 0);
    expect(log.mock.calls[0]![0].ms).toEqual({ firstEvent: 0, total: 200 });
  });

  it.each(["scope", "storage"])("logs one safe failure if %s throws", async (stage) => {
    const log = vi.fn();
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    if (stage === "storage") vi.spyOn(repo, "saveHint").mockRejectedValue(new Error("PROVIDER_SECRET"));
    const events = await collect({
      model: { invoke: async () => response(valid()) }, repo, log,
      scopeLoader: async () => { if (stage === "scope") throw new Error("PROVIDER_SECRET"); return scope; },
    });
    expect(events.at(-1)).toMatchObject({ type: "error", code: "model_unavailable" });
    expectLog(log, events, "model_unavailable", 0);
  });
});

describe("prompt and forced tool", () => {
  it("keeps the two system blocks stable across problems, puts images before request text, and includes history", async () => {
    const scope = await getScopeBundle(request.worksheetId, request.problemId, repo);
    const first = buildMessages(request, scope);
    const other = await getScopeBundle(request.worksheetId, "calc2-ws3/p2", repo);
    const changed = { ...request, problemId: other.problemId, rung: 2 as const, image: { ...request.image, clean: "CLEAN_IMAGE" },
      history: [{ hintId: "old", rung: 1 as const, rowId: request.rowId, text: "What does dx become?", studentWroteAfter: false }] };
    const second = buildMessages(changed, other);
    expect(first[0]?.content).toEqual(second[0]?.content);
    const system = first[0]?.content;
    expect(Array.isArray(system) && system.length).toBe(2);
    const content = second[1]?.content;
    expect(content).toEqual([
      { type: "image_url", image_url: { url: `data:image/png;base64,${request.image.marked}` } },
      { type: "image_url", image_url: { url: "data:image/png;base64,CLEAN_IMAGE" } },
      { type: "text", text: expect.stringContaining('"studentWroteAfter":false') },
    ]);
    expect(Array.isArray(content) && content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining(JSON.stringify(other.problem.statementLatex)) });
    expect(JSON.stringify(system)).toContain("is just ink: ignore it");
    expect(JSON.stringify(system)).not.toContain("cache_control");
  });
  it("uses the installed Bedrock binding to force exactly the named tool without sampling options or network", () => {
    const model = new ChatBedrockConverse({ model: "us.anthropic.claude-sonnet-4-6", region: "us-east-1", credentials: { accessKeyId: "fake", secretAccessKey: "fake" } });
    const bind = vi.spyOn(model, "bindTools");
    expect(getHintModel(model)).toBeDefined();
    expect(bind).toHaveBeenCalledExactlyOnceWith([albertReplyTool], { tool_choice: "albert_reply" });
    expect(Object.keys(albertReplyTool.schema.shape)).toEqual(["reading", "diagnosis", "marks", "hint"]);
    const schema = z.toJSONSchema(albertReplyTool.schema);
    function checkFields(node: unknown): void {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === "object") {
        for (const property of Object.values(record.properties)) expect(property).toHaveProperty("description", expect.any(String));
      }
      Object.values(record).forEach((value) => Array.isArray(value) ? value.forEach(checkFields) : checkFields(value));
    }
    checkFields(schema);
    expect(albertReplyTool.schema.parse(valid())).toEqual(valid());
  });
});
