import { describe, expect, it } from "vitest";
import { computeLevel, computeSkills } from "../../src/lib/progress/levels";
import { recomputeSkills } from "../../src/lib/progress";
import { MemoryRepo } from "../../src/lib/db/memory";
import { TeachingCardSchema, StoredHintSchema, SessionSchema, WorksheetSchema, type EvidenceEvent, type Outcome } from "../../src/lib/contracts";
import { examples } from "./contracts.examples";
const event = (id: string, outcome: Outcome, problemId = id, sessionId = "s1", minute = 30): EvidenceEvent => ({ id, outcome, studentId: "demo", courseId: "course1", subskillId: "sk1", problemId, sessionId, at: new Date(Date.UTC(2026, 10, 14, 0, minute)).toISOString() });
const helped = [event("a", "correct_after_r1"), event("b", "correct_after_r2")];
const independent = [event("a", "unaided_correct"), event("b", "unaided_correct", "b", "s2", 60)];
const warm = [event("h1", "error_made", "other", "s1", 10), event("a", "unaided_correct", "a", "s1", 15), event("h2", "error_made", "other", "s1", 20), event("b", "unaided_correct", "b", "s1", 25)].map(e => e.outcome === "error_made" ? { ...e, hintId: e.id } : e);
describe("P7.2-AC1 level table", () => {
  it("not covered is 0 even with evidence", () => expect(computeLevel(independent, false)).toEqual({ level: 0, evidenceIds: [] }));
  it("covered without events is 1", () => expect(computeLevel([], true).level).toBe(1));
  it("one rung 3 solve is 2", () => expect(computeLevel([event("a", "correct_after_r3")], true).level).toBe(2));
  it("rungs 1 and 2 on independent problems earn 3", () => expect(computeLevel(helped, true).level).toBe(3));
  it("two checks on the same problem stay at 2", () => expect(computeLevel(helped.map(e => ({ ...e, problemId: "same" })), true).level).toBe(2));
  it("two unaided solves in different sessions earn 4", () => expect(computeLevel(independent, true).level).toBe(4));
  it("two warm unaided solves in one session earn 3", () => expect(computeLevel(warm, true).level).toBe(3));
  it("two recent errors demote level 4 to 3", () => expect(computeLevel([...independent, event("x", "error_made", "x", "s3", 70), event("y", "error_made", "y", "s3", 71)], true).level).toBe(3));
  it("one error does not demote level 3", () => expect(computeLevel([...helped, event("x", "error_made", "x", "s1", 70)], true).level).toBe(3));
  it("never drops a taught unit below 1", () => expect(computeLevel([event("x", "abandoned"), event("y", "error_made")], true).level).toBe(1));
});
it("P7.2-AC2 is independent of input order and does not mutate input", () => {
  const all = [...warm, ...independent.map(e => ({ ...e, id: `independent-${e.id}` })), event("end", "abandoned", "c", "s3", 90)];
  const original = structuredClone(all);
  const expected = computeLevel(all, true);
  for (let i = 0; i < all.length; i++) expect(computeLevel([...all.slice(i), ...all.slice(0, i)].reverse(), true)).toEqual(expected);
  expect(all).toEqual(original);
});
it.each([{ events: helped }, { events: independent }])("P7.2-AC3 cites independent real positive events", ({ events }) => {
  const result = computeLevel(events, true);
  expect(result.evidenceIds).toEqual(events.map(e => e.id));
  expect(new Set(result.evidenceIds.map(id => events.find(e => e.id === id)!.problemId)).size).toBe(2);
});
it("handles the exact cold boundary and hints without error evidence", () => {
  const hint = StoredHintSchema.parse(examples.StoredHint.valid);
  const hints = [{ ...hint, at: event("time", "error_made", "a", "s1", 10).at, diagnose: { status: "stalled" as const, privateNote: "", subskillId: "sk1" } }];
  const events = [event("a", "unaided_correct", "a", "s1", 29), event("b", "unaided_correct", "b", "s1", 30)];
  expect(computeLevel(events, true, hints).level).toBe(3);
  expect(computeLevel(events.map(e => ({ ...e, at: event("time", "unaided_correct", "a", "s1", 31).at })), true, hints).level).toBe(4);
});
it("a later session is cold even with a recent hint", () => {
  expect(computeLevel([...warm, event("c", "unaided_correct", "c", "s2", 26)], true).level).toBe(4);
});
it("demotion cites its two failures as well as the positive history", () => {
  const events = [...independent, event("x", "error_made", "x", "s3", 80), event("y", "abandoned", "y", "s3", 90)];
  expect(computeLevel(events, true).evidenceIds).toEqual(["a", "b", "x", "y"]);
});
it("computes all taught and future skills, filters other students/courses, and lists three recent distinct errors", () => {
  const card = TeachingCardSchema.parse(examples.TeachingCard.valid);
  const errors = [1, 2, 3, 4, 5].map(n => ({ ...event(`e${n}`, "error_made", "p", "s", n), errorType: `type${n % 4}` }));
  const evidence = [...helped, ...errors, { ...event("alien", "unaided_correct"), studentId: "other" }];
  const cards = [card, { ...card, unitId: "u2", order: 2, taught: false, subskills: card.subskills.map(s => ({ ...s, id: `future-${s.id}` })) }];
  const skills = computeSkills({ cards, evidence, studentId: "demo", courseId: "course1" });
  expect(skills).toHaveLength(6);
  expect(skills.find(s => s.subskillId === "sk1")).toMatchObject({ level: 3, recentErrorTypes: ["type1", "type0", "type3"] });
  expect(skills.filter(s => s.unitId === "u2").every(s => s.level === 0)).toBe(true);
  expect(computeSkills({ cards: [...cards].reverse(), evidence: [...evidence].reverse(), studentId: "demo", courseId: "course1" })).toEqual(skills);
});
it("recomputes and saves from repository history", async () => {
  const repo = new MemoryRepo();
  await repo.upsertCard(TeachingCardSchema.parse(examples.TeachingCard.valid));
  await repo.createSession(SessionSchema.parse(examples.Session.valid));
  await repo.addEvidence(helped);
  const skills = await recomputeSkills("demo", "course1", repo, helped[0]!.at);
  expect(await repo.listSkills("demo", "course1")).toEqual(skills);
  expect(skills[0]).toMatchObject({ level: 3, evidenceIds: ["a", "b"] });
});

it("uses problem tags for hint timing when a stalled diagnosis omits its skill", async () => {
  const repo = new MemoryRepo();
  await repo.upsertCard(TeachingCardSchema.parse(examples.TeachingCard.valid));
  await repo.upsertWorksheet(WorksheetSchema.parse(examples.Worksheet.valid));
  await repo.createSession(SessionSchema.parse(examples.Session.valid));
  const hint = StoredHintSchema.parse(examples.StoredHint.valid);
  await repo.saveHint({ ...hint, at: event("h", "error_made", "p1", "s1", 10).at });
  await repo.addEvidence([event("a", "unaided_correct", "a", "s1", 15), event("b", "unaided_correct", "b", "s1", 20)]);
  expect((await recomputeSkills("demo", "course1", repo))[0]).toMatchObject({ level: 3 });
  expect((await repo.listHints({ sessionId: "s1" }))[0]!.diagnose.subskillId).toBeUndefined();
});

it("uses actual hint times rather than later assisted-check times when history is supplied", () => {
  const hint = { ...StoredHintSchema.parse(examples.StoredHint.valid), at: event("h", "error_made", "p1", "s1", 0).at, diagnose: { status: "stalled" as const, privateNote: "", subskillId: "sk1" } };
  const events = [event("a", "correct_after_r1", "a", "s1", 30), event("b", "unaided_correct", "b", "s1", 40), event("c", "unaided_correct", "c", "s1", 50)];
  expect(computeLevel(events, true, [hint]).level).toBe(4);
});
