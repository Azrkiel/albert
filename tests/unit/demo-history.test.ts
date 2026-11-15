import { describe, expect, it } from "vitest";
import { validatePlan } from "../../src/lib/agent";
import { MemoryRepo } from "../../src/lib/db";
import { isSeedPlan, seedDemoHistory } from "../../src/lib/progress/demo-history";

const NOW = new Date("2026-11-14T18:00:00.000Z");

describe("seedDemoHistory (seed/demo data)", () => {
  it("loads two earlier sessions with mixed outcomes and a valid hand-written plan marked as seed data", async () => {
    const repo = new MemoryRepo();
    const result = await seedDemoHistory(repo, { now: NOW });
    expect(result).toMatchObject({ sessions: 2, hints: 4, evidence: 9 });
    const plan = (await repo.latestPlan("demo", "calc2"))!;
    expect(isSeedPlan(plan.id)).toBe(true);
    expect(plan.items.length).toBeGreaterThanOrEqual(3);
    const course = { cards: await repo.listCards("calc2"), worksheets: await repo.listWorksheets("calc2"), evidenceIds: (await repo.listEvidence("demo", "calc2")).map((e) => e.id) };
    expect(validatePlan(plan, course)).toEqual([]);
    expect(plan.items[0]!.date).toBe("2026-11-14");
    expect((await repo.listWorksheets("calc2")).map((w) => w.id)).toEqual(["calc2-ws1", "calc2-ws2", "calc2-ws3", "calc2-ws4"]);

    const skills = new Map((await repo.listSkills("demo", "calc2")).map((s) => [s.subskillId, s]));
    expect(skills.get("u1.choose_u")).toMatchObject({ level: 3, evidenceIds: expect.any(Array) });
    expect(skills.get("u1.choose_u")!.evidenceIds).toHaveLength(2);
    expect(skills.get("u3.find_dx")).toMatchObject({ level: 1, recentErrorTypes: ["missing_dx"] });
    expect(skills.get("u4.solve_coefficients")!.level).toBe(0);
    const outcomes = new Set((await repo.listEvidence("demo", "calc2")).map((e) => e.outcome));
    expect(outcomes).toEqual(new Set(["unaided_correct", "correct_after_r1", "error_made", "abandoned"]));
  });

  it("history:false gives cards, worksheets and a plan, and no evidence; another course id re-keys everything", async () => {
    const repo = new MemoryRepo();
    await seedDemoHistory(repo, { courseId: "fresh", history: false, now: NOW });
    expect(await repo.listEvidence("demo", "fresh")).toEqual([]);
    expect((await repo.listSkills("demo", "fresh")).filter((s) => s.unitId !== "fresh/u4").every((s) => s.level === 1)).toBe(true);
    const plan = (await repo.latestPlan("demo", "fresh"))!;
    const course = { cards: await repo.listCards("fresh"), worksheets: await repo.listWorksheets("fresh"), evidenceIds: [] };
    expect(validatePlan(plan, course)).toEqual([]);
    expect(await repo.listCards("calc2")).toHaveLength(4); // the shared base seed is untouched
    expect(await repo.listEvidence("demo", "calc2")).toEqual([]);
  });

  it("is idempotent", async () => {
    const repo = new MemoryRepo();
    await seedDemoHistory(repo, { now: NOW });
    await seedDemoHistory(repo, { now: NOW });
    expect(await repo.listEvidence("demo", "calc2")).toHaveLength(9);
    expect(await repo.listHints({ courseId: "calc2" })).toHaveLength(4);
  });
});
