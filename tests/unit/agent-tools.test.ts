import { describe, expect, it } from "vitest";
import type { StudyPlan } from "../../src/lib/contracts";
import { fileIdFromRef } from "../../src/lib/agent/functions/ingest-flat";
import { validatePlan } from "../../src/lib/agent/functions/plan";
import { createTools, mainTools, TOOL_NAMES } from "../../src/lib/agent/tools";
import { NOW, setup, toDraft } from "./agent-fixtures";

const call = async (tool: { invoke: (input: never) => Promise<unknown> }, input: unknown) => JSON.parse(String(await tool.invoke(input as never)));

describe("P6.3 agent tools", () => {
  it("save_teaching_card rejects an example that is not in the source and leaves the Repo unchanged (AC1)", async () => {
    const { ctx, repo, unit3, card, lectureRefs, events } = await setup();
    const draft = toDraft(card, lectureRefs.length);
    draft.workedExamples[0] = { ...draft.workedExamples[0]!, label: "Lecture 12, Example 9" };
    const result = await call(createTools(ctx).save_teaching_card, { ...draft, unitId: unit3.sectionId });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("Lecture 12, Example 9");
    expect(await repo.listCards(ctx.courseId)).toEqual([]);
    expect(events.at(-1)?.label).toMatch(/^Card rejected/);
  });

  it("save_teaching_card saves a good card with code-assigned ids (AC2)", async () => {
    const { ctx, repo, unit3, card, lectureRefs } = await setup();
    const result = await call(createTools(ctx).save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    expect(result).toMatchObject({ ok: true });
    expect(result.subskills.map((s: { id: string }) => s.id)).toEqual(card.subskills.map((_, n) => `${unit3.sectionId}.s${n + 1}`));
    expect(result.methods[0].id).toBe(`${unit3.sectionId}.m1`);
    const saved = await repo.listCards(ctx.courseId);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ builtBy: "agent", taught: true, order: 3, sourceFileIds: lectureRefs.map(fileIdFromRef) });
    // Saving again updates, never duplicates.
    await call(createTools(ctx).save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    expect(await repo.listCards(ctx.courseId)).toHaveLength(1);
  });

  it("save_teaching_card reports bad indexes and unknown units as problems, not exceptions", async () => {
    const { ctx, repo, unit3, card, lectureRefs } = await setup();
    const draft = toDraft(card, lectureRefs.length);
    draft.pitfalls[0] = { ...draft.pitfalls[0]!, subskillIndex: 99 };
    const bad = await call(createTools(ctx).save_teaching_card, { ...draft, unitId: unit3.sectionId });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join("\n")).toContain("unknown index 99");
    const unknown = await call(createTools(ctx).save_teaching_card, { ...draft, unitId: "nope" });
    expect(unknown).toMatchObject({ ok: false });
    expect(await repo.listCards(ctx.courseId)).toEqual([]);
  });

  it("save_worksheet validates against saved cards and assigns ids and the due date", async () => {
    const { ctx, repo, outline, unit3, card, lectureRefs } = await setup();
    const tools = createTools(ctx);
    const assignment = outline.assignments.find((a) => a.unitOrder === 3)!;
    const fileId = fileIdFromRef(assignment.fileRefs[0]!);
    const problems = [{ label: "1", statementLatex: "$\\int x\\,dx$", page: 1, subskillIds: [`${unit3.sectionId}.s1`], methodIds: [] }];
    const early = await call(tools.save_worksheet, { fileId, title: "Worksheet 3", problems });
    expect(early.ok).toBe(false);
    await call(tools.save_teaching_card, { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId });
    const bad = await call(tools.save_worksheet, { fileId, title: "Worksheet 3", problems: [{ ...problems[0], subskillIds: ["u9.s1"] }] });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join("\n")).toContain("u9.s1");
    const far = await call(tools.save_worksheet, { fileId, title: "Worksheet 3", problems: [{ ...problems[0], page: 9 }] });
    expect(far.problems.join("\n")).toContain("exceeds");
    expect(await repo.listWorksheets(ctx.courseId)).toEqual([]);
    const ok = await call(tools.save_worksheet, { fileId, title: "Worksheet 3", problems });
    expect(ok).toMatchObject({ ok: true, worksheetId: `${fileId}/worksheet` });
    const [saved] = await repo.listWorksheets(ctx.courseId);
    expect(saved).toMatchObject({ dueAt: assignment.dueAt, assignmentId: assignment.id, unitId: unit3.sectionId });
    expect((await call(tools.save_worksheet, { fileId: "nope", title: "x", problems })).ok).toBe(false);
  });

  it("get_progress, get_previous_plan, list_cards and get_due_dates work on an empty history (AC3)", async () => {
    const { ctx } = await setup();
    const tools = createTools(ctx);
    expect(await call(tools.get_progress, {})).toEqual({ skills: [], evidence: [], recentErrors: [] });
    expect(await call(tools.get_previous_plan, {})).toBeNull();
    expect(await call(tools.list_cards, {})).toEqual([]);
    expect(await call(tools.get_due_dates, {})).toEqual([]);
  });

  it("list_cards full returns whole cards for one unit, and a revised card reports worksheets it orphaned", async () => {
    const { ctx, outline, unit3, card, lectureRefs } = await setup();
    const tools = createTools(ctx);
    const draft = { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId };
    await call(tools.save_teaching_card, draft);
    const full = await call(tools.list_cards, { unitId: unit3.sectionId, full: true });
    expect(full).toHaveLength(1);
    expect(full[0].methods[0].steps.length).toBeGreaterThan(1);
    expect(full[0].notation.length).toBeGreaterThan(0);
    expect(await call(tools.list_cards, { unitId: "other", full: true })).toEqual([]);
    const fileId = fileIdFromRef(outline.assignments.find((a) => a.unitOrder === 3)!.fileRefs[0]!);
    await call(tools.save_worksheet, { fileId, title: "W3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${unit3.sectionId}.s5`], methodIds: [] }] });
    const fewer = { ...draft, subskills: draft.subskills.slice(0, 3), pitfalls: draft.pitfalls.map((p) => ({ ...p, subskillIndex: 0 })) };
    const revised = await call(tools.save_teaching_card, fewer);
    expect(revised.ok).toBe(true);
    expect(revised.staleWorksheets).toEqual([expect.objectContaining({ worksheetId: `${fileId}/worksheet` })]);
    expect((await call(tools.save_teaching_card, draft)).staleWorksheets).toBeUndefined();
  });

  it("get_progress reports recent errors", async () => {
    const { ctx, repo } = await setup();
    await repo.addEvidence([{ id: "e1", studentId: "ada", courseId: ctx.courseId, subskillId: "u3.s2", problemId: "p1", sessionId: "s1", at: "2026-11-14T10:00:00Z", outcome: "error_made", errorType: "missing_dx" }]);
    const progress = await call(createTools(ctx).get_progress, {});
    expect(progress.recentErrors).toEqual([expect.objectContaining({ subskillId: "u3.s2", errorType: "missing_dx", evidenceId: "e1" })]);
  });

  it("get_course_outline lists units with fileIds, taught flags and due dates", async () => {
    const { ctx, outline } = await setup();
    const result = await call(createTools(ctx).get_course_outline, {});
    expect(result.units).toHaveLength(outline.units.length);
    const unit3 = result.units.find((u: { order: number }) => u.order === 3);
    expect(unit3.taught).toBe(true);
    expect(unit3.lectureFiles[0]).toMatchObject({ fileIndex: 0, kind: "lecture_notes" });
    expect(result.units.find((u: { order: number }) => u.order === 4).taught).toBe(false);
    expect(result.assignments.length).toBe(outline.assignments.length);
    expect(result.assignments.filter((a: { dueAt?: string }) => a.dueAt).length).toBe(outline.assignments.filter((a) => a.dueAt).length);
  });

  it("read_course_file returns the text and page count", async () => {
    const { ctx, unit3, lectureRefs, reads } = await setup();
    void unit3;
    const out = String(await createTools(ctx).read_course_file.invoke({ fileId: fileIdFromRef(lectureRefs[0]!) } as never));
    expect(out).toMatch(/^Pages: 3\n/);
    expect(reads()).toBe(1);
  });

  it("every tool emits exactly one tool event per call (AC4)", async () => {
    const { ctx, events, unit3, card, lectureRefs, outline } = await setup();
    const tools = createTools(ctx);
    const fileId = fileIdFromRef(lectureRefs[0]!);
    const worksheetId = fileIdFromRef(outline.assignments.find((a) => a.unitOrder === 3)!.fileRefs[0]!);
    const calls: Array<[keyof typeof tools, unknown]> = [
      ["get_course_outline", {}], ["read_course_file", { fileId }],
      ["save_teaching_card", { ...toDraft(card, lectureRefs.length), unitId: unit3.sectionId }],
      ["list_cards", {}],
      ["save_worksheet", { fileId: worksheetId, title: "W3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${unit3.sectionId}.s1`], methodIds: [] }] }],
      ["get_due_dates", {}], ["get_progress", {}], ["get_previous_plan", {}],
      ["save_study_plan", { summary: "s", items: [] }],
    ];
    expect(calls.map(([name]) => name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const [name, input] of calls) {
      const before = events.length;
      await tools[name].invoke(input as never);
      expect(events.length - before, name).toBe(1);
      expect(events.at(-1)).toMatchObject({ type: "tool", at: NOW.toISOString() });
      expect(events.at(-1)?.label.length).toBeGreaterThan(0);
    }
    expect(mainTools(ctx).map((t) => t.name)).toEqual(["get_course_outline", "list_cards"]);
  });
});

describe("save_study_plan and validatePlan", () => {
  async function planSetup() {
    const s = await setup();
    const tools = createTools(s.ctx);
    await call(tools.save_teaching_card, { ...toDraft(s.card, s.lectureRefs.length), unitId: s.unit3.sectionId });
    const assignment = s.outline.assignments.find((a) => a.unitOrder === 3)!;
    const fileId = fileIdFromRef(assignment.fileRefs[0]!);
    await call(tools.save_worksheet, { fileId, title: "Worksheet 3", problems: [{ label: "1", statementLatex: "x", page: 1, subskillIds: [`${s.unit3.sectionId}.s1`], methodIds: [] }] });
    const item = { date: "2026-11-15", worksheetId: `${fileId}/worksheet`, problemIds: [`${fileId}/worksheet/p1`], subskillIds: [`${s.unit3.sectionId}.s1`], estMinutes: 30, reason: "Worksheet 3 is due soon.", evidenceIds: [], dueAt: assignment.dueAt, priority: 1 as const };
    return { ...s, tools, item };
  }

  it("rejects a bad plan without writing and saves a valid one (P6.7-AC3 groundwork)", async () => {
    const { tools, item, repo, ctx } = await planSetup();
    const bad = await call(tools.save_study_plan, { summary: "s", items: [{ ...item, worksheetId: "nope" }] });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join("\n")).toContain("unknown worksheetId");
    expect(await repo.latestPlan("ada", ctx.courseId)).toBeNull();
    const ok = await call(tools.save_study_plan, { summary: "Two plain sentences. Here.", items: [item] });
    expect(ok.ok).toBe(true);
    const saved = (await repo.latestPlan("ada", ctx.courseId)) as StudyPlan;
    expect(saved).toMatchObject({ id: ok.planId, trigger: "manual", horizonDays: 7, generatedAt: NOW.toISOString() });
    expect(saved.items[0]).toMatchObject({ id: "i1", status: "todo" });
    expect(await call(tools.get_previous_plan, {})).toMatchObject({ id: ok.planId });
  });

  it("validatePlan enforces the five rules", async () => {
    const { item, repo, ctx, outline } = await planSetup();
    const cards = await repo.listCards(ctx.courseId);
    const worksheets = await repo.listWorksheets(ctx.courseId);
    const base: StudyPlan = { id: "p", studentId: "ada", courseId: ctx.courseId, generatedAt: NOW.toISOString(), trigger: "manual", horizonDays: 7, summary: "s", items: [{ ...item, id: "i1", status: "todo" }] };
    const course = { cards, worksheets, evidenceIds: ["e1"] };
    expect(validatePlan(base, course)).toEqual([]);
    const withItem = (patch: Partial<StudyPlan["items"][number]>): StudyPlan => ({ ...base, items: [{ ...base.items[0]!, ...patch }] });
    expect(validatePlan(withItem({ problemIds: ["x"] }), course).join()).toContain("problem x");
    expect(validatePlan(withItem({ subskillIds: ["x"] }), course).join()).toContain("unknown subskillId");
    expect(validatePlan(withItem({ date: "2026-11-30" }), course).join()).toContain("outside");
    expect(validatePlan(withItem({ date: "2026-11-13" }), course).join()).toContain("outside");
    const due = "2026-11-15T00:00:00Z";
    expect(validatePlan(withItem({ date: "2026-11-16", dueAt: due }), course).join()).toContain("after its due date");
    const two = { ...base, items: [base.items[0]!, { ...base.items[0]!, id: "i2", estMinutes: 45 }] };
    expect(validatePlan(two, course).join()).toContain("75 minutes");
    expect(validatePlan(withItem({ dueAt: undefined, evidenceIds: [] }), course).join()).toContain("evidenceId or a dueAt");
    expect(validatePlan(withItem({ dueAt: undefined, evidenceIds: ["e1"] }), course)).toEqual([]);
    expect(validatePlan(withItem({ evidenceIds: ["zz"] }), course).join()).toContain("unknown evidenceId zz");
    const upcoming = cards.map((c) => ({ ...c, taught: false }));
    expect(validatePlan(base, { ...course, cards: upcoming }).join()).toContain("upcoming unit");
    void outline;
  });
});

