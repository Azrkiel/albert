import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createCourseAgent, createEventMapper, SUBAGENT_NAMES, SUBAGENT_TOOLS, subagents } from "../../src/lib/agent";
import type { AgentEvent } from "../../src/lib/contracts";
import { setup, toDraft } from "./agent-fixtures";

describe("P6.4 sub-agents", () => {
  it("defines four sub-agents with only their listed tools (AC2)", async () => {
    const { ctx } = await setup();
    const defined = subagents(ctx);
    expect(defined.map((s) => s.name)).toEqual(["unit-reader", "worksheet-mapper", "card-checker", "planner"]);
    expect(SUBAGENT_NAMES).toEqual(defined.map((s) => s.name));
    for (const agent of defined) {
      expect(agent.tools?.map((t) => t.name).sort(), agent.name).toEqual([...SUBAGENT_TOOLS[agent.name as keyof typeof SUBAGENT_TOOLS]].sort());
      expect(agent.description.length).toBeGreaterThan(20);
      expect(agent.systemPrompt).toBeTruthy();
    }
    const byName = Object.fromEntries(defined.map((s) => [s.name, s.tools?.map((t) => t.name) ?? []]));
    expect(byName["unit-reader"]).toEqual(["read_course_file", "save_teaching_card"]);
    expect(byName["card-checker"]).not.toContain("save_teaching_card");
    expect(byName["planner"]).toContain("save_study_plan");
    // Only the planner may save a plan and only the unit-reader may save a card.
    for (const [name, tools] of Object.entries(byName)) {
      expect(tools.includes("save_study_plan"), name).toBe(name === "planner");
      expect(tools.includes("save_teaching_card"), name).toBe(name === "unit-reader");
      expect(tools.includes("get_course_outline"), name).toBe(false);
    }
  });

  it("lets the main agent delegate a unit and the sub-agent saves a validated card (offline AC3)", async () => {
    const { ctx, repo, unit3, card, lectureRefs } = await setup();
    const draft = { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId };
    // One fake model serves the main agent and the sub-agent; its queue is consumed in call order.
    const model = fakeModel()
      .respondWithTools([{ name: "task", args: { description: `Build the card for unit ${unit3.sectionId} only.`, subagent_type: "unit-reader" } }])
      .respondWithTools([{ name: "save_teaching_card", args: draft }])
      .respond(new AIMessage("Unit 3: done."))
      .respond(new AIMessage("Card for unit 3 saved."));
    const events: AgentEvent[] = [];
    const agent = await createCourseAgent({ ...ctx, emit: (e) => events.push(e), model: model as never, store: new InMemoryStore(), checkpointer: new MemorySaver() });
    const map = createEventMapper(() => new Date());
    const messages: BaseMessage[] = [];
    for await (const chunk of await agent.stream({ messages: [{ role: "user", content: "Build the card for unit 3 only." }] }, { configurable: { thread_id: "t" }, streamMode: "updates" })) {
      events.push(...map(chunk));
      for (const update of Object.values(chunk as Record<string, { messages?: BaseMessage[] }>)) if (Array.isArray(update?.messages)) messages.push(...update.messages);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("subagent_start");
    expect(types).toContain("subagent_end");
    expect(events.find((e) => e.type === "subagent_start")).toMatchObject({ label: "unit-reader" });
    expect(events.find((e) => e.type === "tool")?.label).toMatch(/^Saved card: Unit 3/);
    const saved = await repo.listCards(ctx.courseId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ builtBy: "agent", order: 3 });
    expect(events.at(-1)).toMatchObject({ type: "note", label: "summary", detail: "Card for unit 3 saved." });
  });
});
