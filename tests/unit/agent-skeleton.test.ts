import { AIMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { AgentRunSchema } from "../../src/lib/contracts";
import type { AgentEvent } from "../../src/lib/contracts";
import { MemoryRepo } from "../../src/lib/db/memory";
import { courseBackend, createCourseAgent, createEventMapper, runAgent, runIngest } from "../../src/lib/agent";

const todos = [{ content: "first", status: "in_progress" }, { content: "second", status: "pending" }];
const fresh = () => ({ store: new InMemoryStore(), checkpointer: new MemorySaver() });
const text = (m: BaseMessage) => typeof m.content === "string" ? m.content : JSON.stringify(m.content);

async function collect(agent: Awaited<ReturnType<typeof createCourseAgent>>, thread: string, ask: string) {
  const map = createEventMapper(() => new Date("2026-11-14T12:00:00Z"));
  const events: AgentEvent[] = [];
  const messages: BaseMessage[] = [];
  const stream = await agent.stream({ messages: [{ role: "user", content: ask }] }, { configurable: { thread_id: thread }, streamMode: "updates" });
  for await (const chunk of stream) {
    events.push(...map(chunk));
    for (const update of Object.values(chunk as Record<string, { messages?: BaseMessage[] }>)) if (Array.isArray(update?.messages)) messages.push(...update.messages);
  }
  return { events, messages };
}

describe("P6.2 agent skeleton (fake model)", () => {
  it("streams todo, file and summary events (AC1)", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "write_todos", args: { todos } }])
      .respondWithTools([{ name: "write_file", args: { file_path: "/course/hello.md", content: "hello" } }])
      .respond(new AIMessage("Wrote hello.md."));
    const agent = await createCourseAgent({ studentId: "s", courseId: "c", emit: () => {}, model: model as never, ...fresh() });
    const { events } = await collect(agent, "ingest:c", "go");
    expect(events.map((e) => e.type)).toEqual(["todo", "file", "note"]);
    expect(events[0]?.detail).toEqual(todos);
    expect(events[1]).toMatchObject({ label: "/course/hello.md" });
    expect(events[2]).toMatchObject({ label: "summary", detail: "Wrote hello.md." });
  });

  it("keeps /course/ files across threads but not scratch files (AC2)", async () => {
    const shared = fresh();
    const writer = fakeModel()
      .respondWithTools([{ name: "write_file", args: { file_path: "/course/hello.md", content: "persisted note" } }, { name: "write_file", args: { file_path: "/scratch.md", content: "temp" } }])
      .respond(new AIMessage("ok"));
    await collect(await createCourseAgent({ studentId: "s", courseId: "c", emit: () => {}, model: writer as never, ...shared }), "thread-1", "write");
    const reader = fakeModel()
      .respondWithTools([{ name: "read_file", args: { file_path: "/course/hello.md" } }, { name: "read_file", args: { file_path: "/scratch.md" } }])
      .respond(new AIMessage("ok"));
    const { messages } = await collect(await createCourseAgent({ studentId: "s", courseId: "c", emit: () => {}, model: reader as never, ...shared }), "thread-2", "read");
    const results = messages.filter((m) => m.type === "tool").map(text);
    expect(results.some((r) => r.includes("persisted note"))).toBe(true);
    expect(results.some((r) => r.includes("temp"))).toBe(false);
    expect(results.some((r) => r.includes("/scratch.md") && r.includes("not found"))).toBe(true);
    // A different course must not see the file.
    const other = fakeModel().respondWithTools([{ name: "read_file", args: { file_path: "/course/hello.md" } }]).respond(new AIMessage("ok"));
    const { messages: otherMessages } = await collect(await createCourseAgent({ studentId: "s", courseId: "other", emit: () => {}, model: other as never, ...shared }), "thread-3", "read");
    expect(otherMessages.filter((m) => m.type === "tool").map(text).join("")).not.toContain("persisted note");
  });

  it("loads /memories/AGENTS.md into the prompt (AC3)", async () => {
    const shared = fresh();
    expect((await courseBackend({ studentId: "s", courseId: "c" }, shared.store).write("/memories/AGENTS.md", "The student's name is Ada.")).error).toBeUndefined();
    let prompt = "";
    const model = fakeModel().respond((messages) => {
      prompt = messages.map(text).join("\n");
      return new AIMessage("Ada");
    });
    const agent = await createCourseAgent({ studentId: "s", courseId: "c", emit: () => {}, model: model as never, ...shared });
    const { messages } = await collect(agent, "plan:s:c", "what is the student's name?");
    expect(prompt).toContain("The student's name is Ada.");
    expect(messages.some((m) => isAIMessage(m) && m.text === "Ada")).toBe(true);
    // Memory is per student and course.
    prompt = "";
    const model2 = fakeModel().respond((messages) => { prompt = messages.map(text).join("\n"); return new AIMessage("?"); });
    await collect(await createCourseAgent({ studentId: "other", courseId: "c", emit: () => {}, model: model2 as never, ...shared }), "plan:other:c", "name?");
    expect(prompt).not.toContain("Ada");
  });

  it("writes a checkpoint for the thread id (AC4, memory saver)", async () => {
    const shared = fresh();
    const model = fakeModel().respond(new AIMessage("hi"));
    await collect(await createCourseAgent({ studentId: "s", courseId: "c", emit: () => {}, model: model as never, ...shared }), "ingest:c", "go");
    expect(await shared.checkpointer.getTuple({ configurable: { thread_id: "ingest:c" } })).toBeTruthy();
    expect(await shared.checkpointer.getTuple({ configurable: { thread_id: "ingest:none" } })).toBeUndefined();
  });

  it("runAgent stores a valid AgentRun and ends it with note done (runs.ts)", async () => {
    const repo = new MemoryRepo();
    const seen: AgentEvent[] = [];
    const model = fakeModel()
      .respondWithTools([{ name: "write_todos", args: { todos } }])
      .respond(new AIMessage("Nothing to do."));
    const run = await runIngest("c", { repo, studentId: "s", onEvent: (e) => seen.push(e), agent: { model: model as never, ...fresh() } });
    expect(run.status).toBe("succeeded");
    expect(run.threadId).toBe("ingest:c");
    expect(run.events.at(-1)).toMatchObject({ type: "note", label: "done", detail: { cardsSaved: 0, worksheetsSaved: 0 } });
    expect(seen).toEqual(run.events);
    const stored = await repo.getRun(run.id);
    expect(AgentRunSchema.parse(stored).status).toBe("succeeded");
  });

  it("records a failed run without throwing (runs.ts)", async () => {
    const repo = new MemoryRepo();
    const model = fakeModel().alwaysThrow(new Error("provider down"));
    const run = await runAgent("replan", "c", "go", { repo, studentId: "s", agent: { model: model as never, ...fresh() } });
    expect(run.status).toBe("failed");
    expect(run.threadId).toBe("plan:s:c");
    expect(run.events.at(-1)).toMatchObject({ type: "error" });
    expect((await repo.getRun(run.id))?.status).toBe("failed");
  });
});
