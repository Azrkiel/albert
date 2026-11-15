import { describe, expect, it } from "vitest";
import { StoredHintSchema, TutorReportSchema, type StoredHint } from "../../src/lib/contracts";
import { MemoryRepo } from "../../src/lib/db";
import { DEMO_PRIVATE_NOTE, seedDemoHistory } from "../../src/lib/progress/demo-history";
import { buildTutorReport, reportPeriod } from "../../src/lib/progress/report";

const NOW = new Date("2026-11-14T18:00:00.000Z");

async function seeded() {
  const repo = new MemoryRepo();
  await seedDemoHistory(repo, { now: NOW, studentId: "demo" });
  return repo;
}

describe("P7.4-AC1 buildTutorReport", () => {
  it("groups stuck points by subskill and error type, most frequent first, with the right example", async () => {
    const repo = await seeded();
    // A second missing_dx occurrence (another session, another problem) makes it the most frequent.
    await repo.createSession({ id: "later", studentId: "demo", courseId: "calc2", worksheetId: "calc2-ws3", startedAt: "2026-11-14T10:00:00.000Z" });
    const h = (await repo.listHints({ courseId: "calc2" })).find((x) => x.diagnose.errorType === "missing_dx")!;
    const again: StoredHint = StoredHintSchema.parse({ ...h, id: "again", sessionId: "later", problemId: "calc2-ws3/p2", rung: 1, at: "2026-11-14T10:05:00.000Z", snapshotFileId: undefined });
    await repo.saveHint(again);

    const report = TutorReportSchema.parse(await buildTutorReport("demo", "calc2", reportPeriod(NOW), repo, { studentName: "Ada" }));
    expect(report.student).toEqual({ id: "demo", name: "Ada" });
    expect(report.stuckPoints.map((p) => [p.subskillId, p.errorType, p.count])).toEqual([
      ["u3.find_dx", "missing_dx", 2], // rungs 1 and 2 of one mistake are one occurrence; the later session is the second
      ["u1.repeat_parts", "stopped_after_one_round", 1], // ties: most recent first
      ["u1.apply_rule", "sign_error", 1],
    ]);
    const top = report.stuckPoints[0]!;
    expect(top).toMatchObject({ subskillName: "Find dx", unitTitle: "Trigonometric Substitution" });
    expect(top.example).toMatchObject({ hintId: "again", worksheetTitle: "Worksheet 3", problemLabel: "2", tutorNote: DEMO_PRIVATE_NOTE, albertAsked: "You replaced x. What does dx become?" });
    // Ties on count are ordered by recency: the most recent first.
    expect(report.stuckPoints[1]!.lastAt >= report.stuckPoints[2]!.lastAt).toBe(true);
  });

  it("totals are right and the example carries the snapshot of the latest occurrence", async () => {
    const repo = await seeded();
    const report = await buildTutorReport("demo", "calc2", reportPeriod(NOW), repo);
    expect(report.totals.hintsByRung).toEqual({ 1: 3, 2: 1, 3: 0 });
    expect(report.totals.problemsAttempted).toBe(4); // ws1 p1-p3, ws3 p1
    expect(report.totals.solvedUnaided).toBe(1); // ws1 p1 only
    expect(report.totals.minutes).toBe(52 + 38);
    expect(report.stuckPoints.find((p) => p.subskillId === "u3.find_dx")!.example.snapshotFileId).toBe("seed-demo-snapshot:calc2");
    expect(report.summary).toMatch(/dropped dx on Worksheet 3/); // the plan's text
  });

  it("suggestedFocus lists the lowest covered skills, at most three, never an untaught unit", async () => {
    const report = await buildTutorReport("demo", "calc2", reportPeriod(NOW), await seeded());
    expect(report.suggestedFocus).toHaveLength(3);
    const levels = new Map(report.skills.map((s) => [s.name, s.level]));
    for (const name of report.suggestedFocus) expect(levels.get(name)).toBe(1);
    expect(report.skills.some((s) => s.level === 0)).toBe(true);
    expect(report.suggestedFocus.every((n) => (levels.get(n) ?? 0) >= 1)).toBe(true);
    // Skills with a recent error come first among equals.
    expect(report.suggestedFocus[0]).toBe("Repeat parts");
  });

  it("an empty period has no stuck points, and another student's hints never appear", async () => {
    const repo = await seeded();
    const empty = await buildTutorReport("demo", "calc2", { from: "2026-01-01T00:00:00.000Z", to: "2026-01-08T00:00:00.000Z" }, repo);
    expect(empty.stuckPoints).toEqual([]);
    expect(empty.totals).toMatchObject({ minutes: 0, problemsAttempted: 0, solvedUnaided: 0 });
    const other = await buildTutorReport("someone-else", "calc2", reportPeriod(NOW), repo);
    expect(other.stuckPoints).toEqual([]);
  });
});
