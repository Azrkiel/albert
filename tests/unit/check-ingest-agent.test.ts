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

describe("golden checks 12 and 13 (P6.5, R1.1)", () => {
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

  it("check 13 is context coverage: passes with resolved tags, fails on an unresolved tag, a saved plan or a bare card (R1.1-AC1)", async () => {
    const { repo, ctx, outline, unit3, card, lectureRefs } = await setup();
    const withRun = (events = goodEvents, startedAt = at) => checkIngest(ctx.courseId, repo, { run: { ...runWith(events), startedAt }, scopeText: "scope", studentId: "ada" });
    const tools = createTools(ctx);
    await call(tools.save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    const assignment = outline.assignments.find((a) => a.unitOrder === 3)!;
    const fileId = fileIdFromRef(assignment.fileRefs[0]!);
    await call(tools.save_worksheet, { fileId, title: "W3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${unit3.sectionId}.s1`], methodIds: [] }] });
    expect((await withRun()).find((c) => c.number === 13)).toMatchObject({ status: "pass" });
    // A plan from before the run is fine (a repeat ingest on a course that already has one).
    await call(tools.save_study_plan, { summary: "s", items: [{ date: "2026-11-15", worksheetId: `${fileId}/worksheet`, problemIds: [`${fileId}/worksheet/p1`], subskillIds: [`${unit3.sectionId}.s1`], estMinutes: 30, reason: "Due soon.", evidenceIds: [], dueAt: assignment.dueAt, priority: 1 }] });
    expect((await withRun(goodEvents, "2026-11-14T13:00:00.000Z")).find((c) => c.number === 13)?.status).toBe("pass");
    // A plan saved during the run, or a plan tool event, fails it.
    expect((await withRun()).find((c) => c.number === 13)).toMatchObject({ status: "fail", detail: expect.stringContaining("saved a study plan") });
    expect((await withRun([...goodEvents, ev("tool", "Saved study plan: 1 items")], "2026-11-14T13:00:00.000Z")).find((c) => c.number === 13)?.status).toBe("fail");
  });

  it("check 13 fails on an unresolved problem tag and on a taught card without sources or a lecture-labelled example", async () => {
    const { repo, ctx, outline, unit3, card, lectureRefs } = await setup();
    const tools = createTools(ctx);
    await call(tools.save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    const assignment = outline.assignments.find((a) => a.unitOrder === 3)!;
    const fileId = fileIdFromRef(assignment.fileRefs[0]!);
    await call(tools.save_worksheet, { fileId, title: "W3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${unit3.sectionId}.s1`], methodIds: [] }] });
    const run = () => checkIngest(ctx.courseId, repo, { run: runWith(goodEvents), scopeText: "scope", studentId: "ada" });
    expect((await run()).find((c) => c.number === 13)?.status).toBe("pass");
    const [w] = await repo.listWorksheets(ctx.courseId);
    await repo.upsertWorksheet({ ...w!, problems: [{ ...w!.problems[0]!, subskillIds: ["nope.s9"] }] });
    expect((await run()).find((c) => c.number === 13)).toMatchObject({ status: "fail", detail: expect.stringContaining("unresolved subskill nope.s9") });
    await repo.upsertWorksheet(w!);
    const [c] = await repo.listCards(ctx.courseId);
    await repo.upsertCard({ ...c!, sourceFileIds: [], workedExamples: c!.workedExamples.map((e) => ({ ...e, label: "Example" })), lectures: [] });
    const detail = (await run()).find((x) => x.number === 13)!.detail;
    expect(detail).toContain("no sourceFileIds");
    expect(detail).toContain("no worked example with a lecture label");
  });
});
