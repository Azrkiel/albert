import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentRun } from "../../src/lib/contracts";
import { fileIdFromRef } from "../../src/lib/agent/functions/ingest-flat";
import { checkIngest } from "../../src/lib/agent";
import { createTools } from "../../src/lib/agent/tools";
import { setup, toDraft } from "./agent-fixtures";

const at = "2026-11-14T12:00:00.000Z";
const ev = (type: AgentEvent["type"], label: string): AgentEvent => ({ at, type, label });
const runWith = (events: AgentEvent[]): AgentRun => ({ id: "r", kind: "ingest", courseId: "c", studentId: "ada", threadId: "ingest:c", status: "succeeded", startedAt: at, events });
const goodEvents = [ev("todo", "Plan"), ev("subagent_start", "unit-reader"), ev("subagent_start", "unit-reader"), ev("subagent_start", "worksheet-mapper"), ev("file", "/course/scope.md")];
const call = async (tool: { invoke: (input: never) => Promise<unknown> }, input: unknown) => JSON.parse(String(await tool.invoke(input as never)));

describe("golden checks 12 and 13 (P6.5)", () => {
  it("skip without an agent run, as in P6.1", async () => {
    const { repo, ctx } = await setup();
    const checks = await checkIngest(ctx.courseId, repo);
    expect(checks.slice(11).map((c) => c.status)).toEqual(["skipped", "skipped"]);
  });

  it("check 12 needs a todo list, three sub-agent starts and a scope.md write", async () => {
    const { repo, ctx } = await setup();
    const run = async (events: AgentEvent[], scopeText: string | null = "scope") => (await checkIngest(ctx.courseId, repo, { run: runWith(events), scopeText, studentId: "ada" })).find((c) => c.number === 12)!;
    expect((await run(goodEvents)).status).toBe("pass");
    expect((await run(goodEvents.filter((e) => e.type !== "todo"))).status).toBe("fail");
    expect((await run(goodEvents.filter((e, i) => e.type !== "subagent_start" || i < 2))).status).toBe("fail");
    expect((await run(goodEvents.filter((e) => e.type !== "file"))).status).toBe("fail");
    expect((await run(goodEvents, "   ")).status).toBe("fail");
    expect((await run(goodEvents, null)).status).toBe("pass");
  });

  it("check 13 passes for a saved valid plan and fails with no plan or an invalid one", async () => {
    const { repo, ctx, outline, unit3, card, lectureRefs } = await setup();
    const withRun = () => checkIngest(ctx.courseId, repo, { run: runWith(goodEvents), scopeText: "scope", studentId: "ada" });
    expect((await withRun()).find((c) => c.number === 13)).toMatchObject({ status: "fail", detail: "No plan saved" });
    const tools = createTools(ctx);
    await call(tools.save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    const assignment = outline.assignments.find((a) => a.unitOrder === 3)!;
    const fileId = fileIdFromRef(assignment.fileRefs[0]!);
    await call(tools.save_worksheet, { fileId, title: "W3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${unit3.sectionId}.s1`], methodIds: [] }] });
    await call(tools.save_study_plan, { summary: "s", items: [{ date: "2026-11-15", worksheetId: `${fileId}/worksheet`, problemIds: [`${fileId}/worksheet/p1`], subskillIds: [`${unit3.sectionId}.s1`], estMinutes: 30, reason: "Due soon.", evidenceIds: [], dueAt: assignment.dueAt, priority: 1 }] });
    expect((await withRun()).find((c) => c.number === 13)?.status).toBe("pass");
    // Another student has no saved plan.
    const other = await checkIngest(ctx.courseId, repo, { run: runWith(goodEvents), scopeText: "scope", studentId: "someone-else" });
    expect(other.find((c) => c.number === 13)?.status).toBe("fail");
  });
});
