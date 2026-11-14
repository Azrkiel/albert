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
  for await (const event of runHint(req, deps)) events.push(HintEventSchema.parse(event));
  return events;
};
let repo: MemoryRepo;
beforeEach(async () => { repo = new MemoryRepo(); await seedDemo(repo); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("P3.3 runHint", () => {
  it("emits the event order, saves a valid StoredHint with privateNote, and never streams it (AC5)", async () => {
    let now = Date.parse("2026-11-14T16:00:00Z");
    const invoke = vi.fn(async () => { now += 100; return response(valid()); });
    const dispose = vi.fn();
    const events = await collect({ model: { invoke, dispose }, repo, clock: () => now++ });
    expect(events.map((event) => event.type)).toEqual(["started", "reading", "diagnosis", "mark", "hint", "done"]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
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
    const dispose = vi.fn();
    const model: HintModel = { invoke: async (_messages, options) => { signal = options.signal; return new Promise(() => {}); }, dispose };
    const pending = collect({ model, repo, scopeLoader: async () => scope });
    await vi.advanceTimersByTimeAsync(201);
    expect(await pending).toEqual([expect.objectContaining({ type: "error", code: "timeout" })]);
    expect(signal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
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
    const dispose = vi.fn();
    const events = await collect({ model: { invoke, dispose }, repo });
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "model_unavailable" })]);
    expect(JSON.stringify(events)).not.toContain(privateNote);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
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
    const destroy = vi.spyOn(model.client, "destroy");
    const bound = getHintModel(model);
    expect(bound).toBeDefined();
    expect(bind).toHaveBeenCalledExactlyOnceWith([albertReplyTool], { tool_choice: "albert_reply", maxRetries: 0 });
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
    bound.dispose();
    bound.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
