import { tool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentEvent, CourseOutline, FileRef, Repo, StudyPlan, TeachingCard } from "../contracts";
import { PlanItemSchema } from "../contracts";
import { getRepo } from "../db";
import { getAdapter } from "../lms";
import { buildCard, CardDraftSchema, validateCard } from "./functions/extract-card";
import { buildWorksheet, validateWorksheet, WorksheetDraftSchema } from "./functions/extract-worksheet";
import { fileIdFromRef } from "./functions/ingest-flat";
import { planMaxMinutesPerDay, validatePlan } from "./functions/plan";
import { readCourseFile } from "./functions/read-file";
import type { FileText } from "./functions/read-file";

export type ToolContext = {
  courseId: string;
  studentId: string;
  emit: (event: AgentEvent) => void;
  repo?: Repo;
  read?: typeof readCourseFile;
  getOutline?: (courseId: string, repo: Repo) => Promise<CourseOutline>;
  now?: () => Date;
  /** Recorded on a saved plan; the run knows why it started. */
  trigger?: StudyPlan["trigger"];
};

export const TOOL_NAMES = [
  "get_course_outline", "read_course_file", "save_teaching_card", "list_cards", "save_worksheet",
  "get_due_dates", "get_progress", "get_previous_plan", "save_study_plan",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const json = (value: unknown): string => JSON.stringify(value);
const LECTURE_KINDS = new Set<FileRef["kindGuess"]>(["lecture_notes", "slides"]);

async function outlineOf(ctx: ToolContext, repo: Repo): Promise<CourseOutline> {
  if (ctx.getOutline) return ctx.getOutline(ctx.courseId, repo);
  return (await getAdapter(ctx.courseId, repo)).getOutline(ctx.courseId);
}

/** Thin wrappers over the P6.1 functions and the Repo. Save tools validate and return problems; they never throw on bad content. */
export function createTools(ctx: ToolContext): Record<ToolName, StructuredTool> {
  const repo = () => ctx.repo ?? getRepo();
  const clock = () => (ctx.now ?? (() => new Date()))();
  const note = (label: string, detail?: unknown) => ctx.emit({ at: clock().toISOString(), type: "tool", label, ...(detail === undefined ? {} : { detail }) });
  const read = ctx.read ?? readCourseFile;

  const unitLectures = async (outline: CourseOutline, unitId: string) => {
    const unit = outline.units.find((u) => u.sectionId === unitId);
    if (!unit) return null;
    const files = unit.files.filter((f) => LECTURE_KINDS.has(f.kindGuess));
    const texts: FileText[] = [];
    for (const ref of files) {
      const fileId = fileIdFromRef(ref);
      texts.push({ fileId, lectureLabel: ref.lectureLabel, ...await read(fileId, { repo: repo() }) });
    }
    return { unit, texts, taught: files.length > 0 };
  };

  const get_course_outline = tool(async () => {
    const outline = await outlineOf(ctx, repo());
    const file = (ref: FileRef) => ({ fileId: fileIdFromRef(ref), title: ref.title, kind: ref.kindGuess, ...(ref.lectureLabel ? { lectureLabel: ref.lectureLabel } : {}) });
    const units = [...outline.units].sort((a, b) => a.order - b.order).map((u) => {
      const lectureFiles = u.files.filter((f) => LECTURE_KINDS.has(f.kindGuess)).map((f, fileIndex) => ({ fileIndex, ...file(f) }));
      return { unitId: u.sectionId, order: u.order, title: u.title, taught: lectureFiles.length > 0, lectureFiles, worksheetFiles: u.files.filter((f) => f.kindGuess === "worksheet").map(file) };
    });
    note(`Read outline: ${units.length} units, ${outline.assignments.length} assignments`);
    return json({
      course: outline.course,
      syllabusFileIds: outline.files.filter((f) => f.kindGuess === "syllabus").map(fileIdFromRef),
      units,
      assignments: outline.assignments.map((a) => ({ id: a.id, title: a.title, unitOrder: a.unitOrder, dueAt: a.dueAt, worksheetFileIds: a.fileRefs.map(fileIdFromRef) })),
    });
  }, {
    name: "get_course_outline",
    description: "Get the course outline: units (with unitId, whether taught, and lecture files in fileIndex order), worksheet files, assignments with due dates, and the syllabus file ids. Call this first. Returns JSON.",
    schema: z.object({}),
  });

  const read_course_file = tool(async ({ fileId }) => {
    const r = repo();
    const title = (await r.getFile(fileId))?.meta.title ?? fileId;
    const result = await read(fileId, { repo: r });
    note(`Read ${title}`);
    return `Pages: ${result.pages}\n${result.text}`;
  }, {
    name: "read_course_file",
    description: "Read one course file (a fileId from get_course_outline) as faithful Markdown with LaTeX and `--- page N ---` markers. Use before saving anything that quotes the file. Returns the text.",
    schema: z.object({ fileId: z.string() }),
  });

  const save_teaching_card = tool(async ({ unitId, ...draft }) => {
    const r = repo();
    const context = await unitLectures(await outlineOf(ctx, r), unitId);
    if (!context) {
      note(`Card rejected: unknown unit ${unitId}`);
      return json({ ok: false, problems: [`Unknown unitId ${unitId}; use a unitId from get_course_outline.`] });
    }
    const { unit, texts, taught } = context;
    const cardUnit = { id: unit.sectionId, courseId: ctx.courseId, order: unit.order, title: unit.title };
    let card: TeachingCard;
    try {
      card = buildCard(draft, cardUnit, texts, taught, "agent");
    } catch (error) {
      const problems = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : [error instanceof Error ? error.message : "Card could not be assembled"];
      note(`Card rejected: ${unit.title} (${problems.length} problems)`);
      return json({ ok: false, problems });
    }
    const problems = validateCard(card, texts);
    if (problems.length) {
      note(`Card rejected: ${unit.title} (${problems.length} problems)`);
      return json({ ok: false, problems });
    }
    await r.upsertCard(card);
    note(`Saved card: Unit ${unit.order} — ${card.title}`);
    return json({ ok: true, subskills: card.subskills.map((s) => ({ id: s.id, name: s.name })), methods: card.methods.map((m) => ({ id: m.id, name: m.name })) });
  }, {
    name: "save_teaching_card",
    description: "Validate and save one unit's teaching card. fileIndex values refer to that unit's lectureFiles in get_course_outline; method and subskill indexes are zero-based into the arrays you give. Ids are assigned for you. Returns {ok:true, subskills, methods} or {ok:false, problems}: fix every problem and call again. Nothing is saved while problems remain.",
    schema: CardDraftSchema.extend({ unitId: z.string().describe("unitId from get_course_outline") }),
  });

  const list_cards = tool(async () => {
    const cards = [...await repo().listCards(ctx.courseId)].sort((a, b) => a.order - b.order);
    note(`Listed ${cards.length} cards`);
    return json(cards.map((c) => ({
      unitId: c.unitId, order: c.order, title: c.title, taught: c.taught,
      methods: c.methods.map((m) => ({ id: m.id, name: m.name })),
      subskills: c.subskills.map((s) => ({ id: s.id, name: s.name })),
      exampleLabels: c.workedExamples.map((e) => e.label),
    })));
  }, {
    name: "list_cards",
    description: "List this course's saved teaching cards in compact form: unit, title, taught, method names and ids, subskills with ids, example labels. Returns JSON.",
    schema: z.object({}),
  });

  const save_worksheet = tool(async ({ fileId, ...draft }) => {
    const r = repo();
    const outline = await outlineOf(ctx, r);
    const owner = outline.units.find((u) => u.files.some((f) => f.kindGuess === "worksheet" && fileIdFromRef(f) === fileId))
      ?? outline.units.find((u) => outline.assignments.some((a) => a.unitOrder === u.order && a.fileRefs.some((f) => fileIdFromRef(f) === fileId)));
    const stored = await r.getFile(fileId);
    if (!owner || !stored) {
      note(`Worksheet rejected: unknown file ${fileId}`);
      return json({ ok: false, problems: [`Unknown worksheet fileId ${fileId}; use a worksheetFiles fileId from get_course_outline.`] });
    }
    const assignment = outline.assignments.find((a) => a.fileRefs.some((f) => fileIdFromRef(f) === fileId));
    let worksheet;
    try {
      worksheet = buildWorksheet(draft, { file: stored.meta, unit: { id: owner.sectionId, courseId: ctx.courseId, order: owner.order, title: owner.title }, dueAt: assignment?.dueAt, assignmentId: assignment?.id });
    } catch (error) {
      const problems = error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) : ["Worksheet could not be assembled"];
      note(`Worksheet rejected: ${draft.title} (${problems.length} problems)`);
      return json({ ok: false, problems });
    }
    const pages = (await read(fileId, { repo: r })).pages;
    const problems = [
      ...validateWorksheet(worksheet, await r.listCards(ctx.courseId)),
      ...worksheet.problems.filter((p) => p.page > pages).map((p) => `Problem ${p.label}: page ${p.page} exceeds the file's ${pages} pages`),
    ];
    if (problems.length) {
      note(`Worksheet rejected: ${worksheet.title} (${problems.length} problems)`);
      return json({ ok: false, problems });
    }
    await r.upsertWorksheet(worksheet);
    note(`Saved worksheet: ${worksheet.title} (${worksheet.problems.length} problems)`);
    return json({ ok: true, worksheetId: worksheet.id, problems: worksheet.problems.map((p) => ({ id: p.id, label: p.label })) });
  }, {
    name: "save_worksheet",
    description: "Validate and save one worksheet: its fileId from get_course_outline, a title, and every problem with label, statementLatex, page, subskillIds and methodIds taken from list_cards (own unit or earlier only). Ids and due date are assigned for you. Returns {ok:true,...} or {ok:false, problems}: fix and call again.",
    schema: WorksheetDraftSchema.extend({ fileId: z.string() }),
  });

  const get_due_dates = tool(async () => {
    const worksheets = await repo().listWorksheets(ctx.courseId);
    note(`Listed due dates for ${worksheets.length} worksheets`);
    return json(worksheets.map((w) => ({ worksheetId: w.id, title: w.title, unitId: w.unitId, dueAt: w.dueAt ?? null, problems: w.problems.map((p) => ({ id: p.id, label: p.label, subskillIds: p.subskillIds })) })));
  }, {
    name: "get_due_dates",
    description: "List the course's worksheets with due dates and problem ids, labels and subskills. Returns JSON.",
    schema: z.object({}),
  });

  const get_progress = tool(async () => {
    const r = repo();
    const [skills, evidence] = await Promise.all([r.listSkills(ctx.studentId, ctx.courseId), r.listEvidence(ctx.studentId, ctx.courseId)]);
    const recent = [...evidence].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
    const recentErrors = recent.filter((e) => e.outcome === "error_made" && e.errorType).map((e) => ({ subskillId: e.subskillId, errorType: e.errorType, problemId: e.problemId, evidenceId: e.id, at: e.at }));
    note(`Read progress: ${skills.length} skills, ${evidence.length} evidence events`);
    return json({ skills: skills.map((s) => ({ subskillId: s.subskillId, unitId: s.unitId, level: s.level, recentErrorTypes: s.recentErrorTypes })), evidence: recent, recentErrors });
  }, {
    name: "get_progress",
    description: "Get the student's skill levels, the 30 most recent evidence events and recent error types. All are empty lists before any session. Returns {skills, evidence, recentErrors}.",
    schema: z.object({}),
  });

  const get_previous_plan = tool(async () => {
    const plan = await repo().latestPlan(ctx.studentId, ctx.courseId);
    note(plan ? "Read previous plan" : "No previous plan");
    return json(plan);
  }, {
    name: "get_previous_plan",
    description: "Get the student's latest saved study plan, or null if there is none.",
    schema: z.object({}),
  });

  const save_study_plan = tool(async ({ summary, items }) => {
    const r = repo();
    const plan: StudyPlan = {
      id: nanoid(), studentId: ctx.studentId, courseId: ctx.courseId, generatedAt: clock().toISOString(), trigger: ctx.trigger ?? "manual", horizonDays: 7, summary,
      items: items.map((item, n) => ({ ...item, id: `i${n + 1}`, status: "todo" as const })),
    };
    const [cards, worksheets, evidence] = await Promise.all([r.listCards(ctx.courseId), r.listWorksheets(ctx.courseId), r.listEvidence(ctx.studentId, ctx.courseId)]);
    const problems = validatePlan(plan, { cards, worksheets, evidenceIds: evidence.map((e) => e.id) }, planMaxMinutesPerDay());
    if (problems.length) {
      note(`Plan rejected (${problems.length} problems)`);
      return json({ ok: false, problems });
    }
    await r.savePlan(plan);
    note(`Saved study plan: ${plan.items.length} items`);
    return json({ ok: true, planId: plan.id });
  }, {
    name: "save_study_plan",
    description: "Validate and save the 7-day study plan: a two-sentence summary and items (date YYYY-MM-DD from today, worksheetId, problemIds, subskillIds, estMinutes 5-45, one-sentence reason, evidenceIds, dueAt, priority). Ids, status and generatedAt are assigned for you. Returns {ok:true, planId} or {ok:false, problems}: fix and call again.",
    schema: z.object({ summary: z.string(), items: z.array(PlanItemSchema.omit({ id: true, status: true })) }),
  });

  return { get_course_outline, read_course_file, save_teaching_card, list_cards, save_worksheet, get_due_dates, get_progress, get_previous_plan, save_study_plan } as unknown as Record<ToolName, StructuredTool>;
}

/** The main agent's own tools; the sub-agents get theirs in P6.4. */
export function mainTools(ctx: ToolContext): StructuredTool[] {
  return [createTools(ctx).get_course_outline];
}
