import { TutorReportSchema, type Repo, type Session, type StoredHint, type TeachingCard, type TutorReport, type Worksheet } from "../contracts";

const DAY = 86_400_000;
export const REPORT_DAYS = 7;

/** The default "this week" period ending at `now`. */
export const reportPeriod = (now: Date): TutorReport["period"] => ({ from: new Date(now.getTime() - REPORT_DAYS * DAY).toISOString(), to: now.toISOString() });

const hintText = (hint: StoredHint) => hint.hint.segments.map((s) => (s.type === "text" ? s.text : s.type === "math" ? `$${s.latex}$` : " ")).join("").replace(/\s+/g, " ").trim();
const rowText = (hint: StoredHint) => {
  const { rowIndex } = hint.diagnose;
  const rows = hint.reading.rows;
  return (rows.find((r) => r.index === rowIndex) ?? rows.at(-1))?.latex ?? "";
};

/** Hints are grouped by what went wrong. One mistake is one occurrence however many rungs it took. */
type Group = { subskillId: string; errorType: string; occurrences: Map<string, StoredHint[]> };

/**
 * Builds the tutor report from stored hints, evidence, skills, sessions and the plan. Plain code over Repo reads:
 * no model call, no clock (the caller passes `period`).
 */
export async function buildTutorReport(studentId: string, courseId: string, period: TutorReport["period"], repo: Repo, options: { studentName?: string } = {}): Promise<TutorReport> {
  const from = Date.parse(period.from), to = Date.parse(period.to);
  const inPeriod = (at: string) => Date.parse(at) >= from && Date.parse(at) <= to;
  const [course, cards, worksheets, evidence, skills, plan, allHints] = await Promise.all([
    repo.getCourse(courseId), repo.listCards(courseId), repo.listWorksheets(courseId), repo.listEvidence(studentId, courseId),
    repo.listSkills(studentId, courseId), repo.latestPlan(studentId, courseId), repo.listHints({ courseId }),
  ]);
  const sessions = (await Promise.all([...new Set(allHints.map((h) => h.sessionId))].map((id) => repo.getSession(id))))
    .filter((s): s is Session => s !== null && s.studentId === studentId && s.courseId === courseId);
  const own = new Set(sessions.map((s) => s.id));
  const hints = allHints.filter((h) => own.has(h.sessionId) && inPeriod(h.at));
  const events = evidence.filter((e) => inPeriod(e.at));

  const subskill = new Map<string, { name: string; unitTitle: string; order: number }>();
  const unitTitle = new Map<string, string>();
  cards.forEach((c: TeachingCard, ci) => { unitTitle.set(c.unitId, c.title); c.subskills.forEach((s, si) => subskill.set(s.id, { name: s.name, unitTitle: c.title, order: ci * 100 + si })); });
  const problem = new Map<string, { sheet: Worksheet; label: string }>();
  for (const w of worksheets) for (const p of w.problems) problem.set(p.id, { sheet: w, label: p.label });

  const groups = new Map<string, Group>();
  for (const h of hints) {
    const { status, subskillId, errorType } = h.diagnose;
    if (status !== "error" || !subskillId || !errorType) continue;
    const key = JSON.stringify([subskillId, errorType]);
    const g = groups.get(key) ?? { subskillId, errorType, occurrences: new Map() };
    const occ = JSON.stringify([h.sessionId, h.problemId]);
    g.occurrences.set(occ, [...(g.occurrences.get(occ) ?? []), h]);
    groups.set(key, g);
  }
  const stuckPoints = [...groups.values()].map((g) => {
    const occurrences = [...g.occurrences.values()].map((hs) => [...hs].sort((a, b) => a.rung - b.rung || a.at.localeCompare(b.at)));
    const times = occurrences.flat().map((h) => h.at).sort();
    const latest = [...occurrences].sort((a, b) => b[0]!.at.localeCompare(a[0]!.at))[0]!;
    // The example is the first question Albert asked about the latest occurrence.
    const example = latest[0]!;
    const snapshotFileId = latest.find((h) => h.snapshotFileId)?.snapshotFileId;
    const where = problem.get(example.problemId);
    const info = subskill.get(g.subskillId);
    return {
      subskillId: g.subskillId, subskillName: info?.name ?? g.subskillId, unitTitle: info?.unitTitle ?? "", errorType: g.errorType,
      count: occurrences.length, lastAt: times.at(-1)!,
      example: { hintId: example.id, worksheetTitle: where?.sheet.title ?? "Worksheet", problemLabel: where?.label ?? "", ...(snapshotFileId ? { snapshotFileId } : {}),
        albertRead: rowText(example), albertAsked: hintText(example), tutorNote: example.diagnose.privateNote },
    };
  }).sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt) || a.subskillId.localeCompare(b.subskillId) || a.errorType.localeCompare(b.errorType));

  const hintsByRung = { 1: 0, 2: 0, 3: 0 };
  for (const h of hints) hintsByRung[h.rung]++;
  const solved = new Set(events.filter((e) => e.outcome === "unaided_correct").map((e) => e.problemId));
  const attempted = new Set([...hints.map((h) => h.problemId), ...events.map((e) => e.problemId)]);
  const minutes = sessions.reduce((sum, s) => {
    const started = Date.parse(s.startedAt);
    if (started > to) return sum;
    const lastActivity = Math.max(started, ...allHints.filter((h) => h.sessionId === s.id).map((h) => Date.parse(h.at)), ...evidence.filter((e) => e.sessionId === s.id).map((e) => Date.parse(e.at)));
    const end = s.endedAt ? Date.parse(s.endedAt) : lastActivity;
    return end < from ? sum : sum + Math.max(0, Math.min(end, to) - Math.max(started, from)) / 60_000;
  }, 0);

  const enriched = skills.map((s) => ({ ...s, name: subskill.get(s.subskillId)?.name ?? s.subskillId, unitTitle: unitTitle.get(s.unitId) ?? "" }))
    .sort((a, b) => (subskill.get(a.subskillId)?.order ?? 0) - (subskill.get(b.subskillId)?.order ?? 0));
  const suggestedFocus = enriched.filter((s) => s.level >= 1)
    .sort((a, b) => a.level - b.level || b.recentErrorTypes.length - a.recentErrorTypes.length || (subskill.get(a.subskillId)?.order ?? 0) - (subskill.get(b.subskillId)?.order ?? 0))
    .slice(0, 3).map((s) => s.name);

  const top = stuckPoints[0];
  const summary = plan?.summary ?? (top ? `Most common stuck point this week: ${top.subskillName.toLowerCase()} (${top.count} ${top.count === 1 ? "time" : "times"}).` : "No stuck points recorded this week.");
  return TutorReportSchema.parse({
    course: { id: courseId, title: course?.title ?? cards[0]?.title ?? courseId },
    student: { id: studentId, name: options.studentName ?? studentId }, period, summary,
    totals: { minutes: Math.round(minutes), problemsAttempted: attempted.size, solvedUnaided: solved.size, hintsByRung },
    stuckPoints, skills: enriched, suggestedFocus,
  });
}
