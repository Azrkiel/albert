import { PDFDocument } from "pdf-lib";
import type { AgentRun, CourseOutline, Repo, StudyPlan, TeachingCard, Worksheet } from "../../contracts";
import { validateCard } from "./extract-card";
import { validateWorksheet } from "./extract-worksheet";
import { fileIdFromRef } from "./ingest-flat";
import { planMaxMinutesPerDay, validatePlan } from "./plan";
import type { FileText } from "./read-file";

export type GoldenCheck = { number: number; status: "pass" | "fail" | "skipped"; detail: string };
/** Checks 12 and 13 need an agent run; without one they are skipped. `evidenceIds` are the student's evidence ids for validatePlan. */
export type AgentRunData = { run: AgentRun; scopeText: string | null; plan: StudyPlan | null; evidenceIds: string[] };
export type IngestData = { outline: CourseOutline; cards: TeachingCard[]; worksheets: Worksheet[]; sources: FileText[]; agent?: AgentRunData };

/** P6.5's synthetic markers only. No model, network, clock or agent runtime. */
export function checkIngestData({ outline, cards, worksheets, sources, agent }: IngestData): GoldenCheck[] {
  const results: GoldenCheck[] = [];
  const check = (number: number, ok: boolean, detail: string) => results.push({ number, status: ok ? "pass" : "fail", detail });
  const unitCard = (order: number) => cards.find(c => c.unitId === outline.units.find(u => u.order === order)?.sectionId);
  const u1 = unitCard(1), u3 = unitCard(3), u4 = unitCard(4);
  const related = cards.filter(c => c.courseId === outline.course.id);
  check(1, related.length === 5 && outline.units.length === 5 && outline.units.every(u => {
    const found = related.filter(c => c.unitId === u.sectionId);
    return found.length === 1 && found[0]!.order === u.order && found[0]!.taught === (u.order <= 3) && validateCard(found[0]!, sources).length === 0;
  }), "Five valid cards; units 1–3 taught, 4–5 upcoming");
  check(2, !!u1?.notation.some(n => n.teacherWrites.includes("dy") && n.teacherWrites.includes("dx") && n.avoid.some(a => a.includes("f'(x)"))), "M1 Leibniz notation avoids f'(x)");
  check(3, !!u1?.methods.some(m => /LIATE/i.test(JSON.stringify(m))), "M2 LIATE");
  check(4, !!u3?.methods.some(m => m.steps.length === 5 && /dx/.test(m.steps[1]!) && /triangle/i.test(m.steps[4]!)), "M3 five-step recipe, dx second, triangle fifth");
  const compact = JSON.stringify([u3?.methods, u3?.notation]).replaceAll("\\\\", "\\").replace(/\s|[{}]/g, "");
  check(5, ["a\\sin\\theta", "a\\tan\\theta", "a\\sec\\theta"].every(s => compact.includes(s)), "M4 all three substitution-table rows");
  // Entries that name the angle symbol itself: a concept naming the angle, theta or new variable whose teacherWrites is one symbol (TeX dollars ignored).
  const bare = (t: string) => t.replace(/[$\s]/g, "");
  const angles = u3?.notation.filter(n => /angle|theta|θ|new variable/i.test(n.concept) && /^\\?[A-Za-z]+$/.test(bare(n.teacherWrites))) ?? [];
  check(6, !!u3?.conventions.some(c => /reference triangle/i.test(c)) && angles.length > 0 && angles.every(n => bare(n.teacherWrites) === "\\theta"), "M5 reference triangle and angle theta");
  check(7, !!u3?.workedExamples.some(e => e.label === "Lecture 9, Example 2"), "M6 Lecture 9, Example 2");
  check(8, !!u3?.pitfalls.some(p => p.errorType.includes("dx")), "Unit 3 dx pitfall");
  check(9, !!u4?.methods.some(m => /partial fractions?/i.test(m.name) && m.steps.length === 0), "M8 upcoming partial fractions, no steps");
  const assignment = (n: number) => outline.assignments.find(a => a.unitOrder === n);
  const forAssignment = (n: number) => {
    const a = assignment(n);
    const ids = new Set(a?.fileRefs.map(fileIdFromRef));
    return worksheets.filter(w => w.courseId === outline.course.id && w.assignmentId === a?.id && ids.has(w.fileId));
  };
  check(10, worksheets.length === 4 && new Set(worksheets.map(w => w.id)).size === 4 && new Set(worksheets.map(w => w.fileId)).size === 4 && forAssignment(3).length === 1 && forAssignment(3)[0]!.problems.length === 5 && worksheets.every(w => validateWorksheet(w, cards).length === 0), "Four valid worksheets; Worksheet 3 has five problems");
  check(11, [3, 4].every(n => {
    const a = assignment(n), ws = forAssignment(n);
    return !!a?.dueAt && ws.length === 1 && ws[0]!.dueAt === a.dueAt;
  }), "Worksheet 3/4 due dates match pinned outline");
  if (!agent) {
    for (const number of [12, 13]) results.push({ number, status: "skipped", detail: "agent run, P6.5" });
    return results;
  }
  const starts = agent.run.events.filter(e => e.type === "subagent_start").length;
  const wroteScope = agent.run.events.some(e => e.type === "file" && e.label === "/course/scope.md");
  check(12, agent.run.events.some(e => e.type === "todo") && starts >= 3 && wroteScope && (agent.scopeText === null || agent.scopeText.trim().length > 0), `Run produced a todo list, ${starts} subagent_start events and ${wroteScope ? "a" : "no"} /course/scope.md write`);
  const planProblems = agent.plan ? validatePlan(agent.plan, { cards, worksheets, evidenceIds: agent.evidenceIds }, planMaxMinutesPerDay()) : ["No plan saved"];
  check(13, planProblems.length === 0, planProblems.length ? planProblems.join("; ") : `Plan ${agent.plan!.id} saved and valid (${agent.plan!.items.length} items)`);
  return results;
}

export async function checkIngest(courseId: string, repo: Repo, agent?: { run: AgentRun; scopeText: string | null; studentId: string }): Promise<GoldenCheck[]> {
  const outline = await repo.getOutline(courseId);
  if (!outline) throw new Error("Missing outline; reimport the course source.");
  const sources: FileText[] = [];
  for (const ref of outline.units.flatMap(u => u.files).filter(f => f.kindGuess === "lecture_notes" || f.kindGuess === "slides")) {
    const fileId = fileIdFromRef(ref), file = await repo.getFile(fileId);
    if (!file?.meta.textCacheId) continue;
    const text = await repo.getText(file.meta.textCacheId);
    if (text === null) continue;
    sources.push({ fileId, text, pages: (await PDFDocument.load(file.bytes)).getPageCount() });
  }
  const agentData: AgentRunData | undefined = agent && {
    run: agent.run, scopeText: agent.scopeText,
    plan: await repo.latestPlan(agent.studentId, courseId),
    evidenceIds: (await repo.listEvidence(agent.studentId, courseId)).map(e => e.id),
  };
  return checkIngestData({ outline, cards: await repo.listCards(courseId), worksheets: await repo.listWorksheets(courseId), sources, agent: agentData });
}
