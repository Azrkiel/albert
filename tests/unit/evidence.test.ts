import { describe, expect, it, vi } from "vitest";
import { SessionSchema, StoredHintSchema, TeachingCardSchema, WorksheetSchema, type CheckResponse } from "../../src/lib/contracts";
import { examples } from "./contracts.examples";
import { evidenceFromHint, evidenceFromCheck, evidenceFromSessionEnd, type EvidenceContext } from "../../src/lib/tutor/evidence";
import { recordHintEvidence, recordCheckEvidence } from "../../src/lib/tutor/record-evidence";
import { MemoryRepo } from "../../src/lib/db/memory";
const session = SessionSchema.parse(examples.Session.valid);
const card = TeachingCardSchema.parse(examples.TeachingCard.valid);
const base = StoredHintSchema.parse(examples.StoredHint.valid);
const hint = { ...base, sessionId: session.id, courseId: session.courseId, diagnose: { status: "error" as const, subskillId: "sk1", errorType: "missing_dx", privateNote: "Missing dx" } };
const ctx: EvidenceContext = { ...session, subskillIds: ["sk1", "sk2"], evidence: [], at: base.at };
const problem = { ...WorksheetSchema.parse(examples.Worksheet.valid).problems[0]!, subskillIds: ["sk1", "sk2"] };
const check: CheckResponse = { verdict: "correct", reading: [], subskillIds: ["untrusted"] };
describe("P7.1-AC1", () => {
  it("records one error across all rungs and retries", () => {
    const first = evidenceFromHint(hint, ctx);
    expect(first).toMatchObject([{ outcome: "error_made", errorType: "missing_dx", hintId: hint.id }]);
    for (const rung of [1, 2, 3] as const) expect(evidenceFromHint({ ...hint, rung }, { ...ctx, evidence: first })).toEqual([]);
  });
  it.each(["on_track", "stalled", "unreadable"] as const)("ignores %s", status => {
    expect(evidenceFromHint({ ...hint, diagnose: { ...hint.diagnose, status } }, ctx)).toEqual([]);
  });
  it("records each problem skill with the highest rung; ignores other sessions and problems", () => {
    expect(evidenceFromCheck(check, problem, [], ctx).map(e => e.outcome)).toEqual(["unaided_correct", "unaided_correct"]);
    const hints = [{ ...hint, rung: 1 as const }, { ...hint, rung: 2 as const }, { ...hint, rung: 3 as const, sessionId: "other" }];
    expect(evidenceFromCheck(check, problem, hints, ctx).map(e => e.outcome)).toEqual(["correct_after_r2", "correct_after_r2"]);
    expect(evidenceFromCheck(check, problem, [], { ...ctx, evidence: evidenceFromCheck(check, problem, hints, ctx) })).toEqual([]);
  });
  it.each(["not_yet", "unreadable"] as const)("ignores %s checks", verdict => {
    expect(evidenceFromCheck({ ...check, verdict }, problem, [], ctx)).toEqual([]);
  });
  it("abandons unfinished error-hinted skills once, excluding solved problems", () => {
    expect(evidenceFromSessionEnd(ctx, [hint, hint], [])).toMatchObject([{ outcome: "abandoned", subskillId: "sk1" }]);
    expect(evidenceFromSessionEnd(ctx, [hint], [{ type: "check_result", at: 1, problemId: hint.problemId, verdict: "correct" }])).toEqual([]);
  });
});
it("P7.1-AC3 rejects an unknown course subskill and warns at the storage boundary", async () => {
  const repo = new MemoryRepo();
  await repo.upsertCard({ ...card, courseId: session.courseId });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await recordHintEvidence(repo, { ...hint, diagnose: { ...hint.diagnose, subskillId: "unknown" } }, session)).toEqual([]);
    expect(warn).toHaveBeenCalledWith("Unknown hint subskill", "unknown");
  } finally { warn.mockRestore(); }
});
it("persists hints and deduplicated evidence through the route integration functions", async () => {
  const repo = new MemoryRepo();
  await repo.upsertCard({ ...card, courseId: session.courseId });
  await recordHintEvidence(repo, hint, session);
  await recordHintEvidence(repo, { ...hint, id: "r2", rung: 2 }, session);
  await recordCheckEvidence(repo, check, problem, session, ctx.at);
  expect(await repo.listHints({ sessionId: session.id })).toHaveLength(2);
  expect(await repo.listEvidence(session.studentId, session.courseId)).toHaveLength(3);
});
it("resolves persisted sessions without exposing mutable state", async () => {
  const repo = new MemoryRepo();
  expect(await repo.getSession(session.id)).toBeNull();
  await repo.createSession(session);
  const saved = await repo.getSession(session.id);
  expect(saved).toEqual(session);
  saved!.studentId = "changed";
  expect(await repo.getSession(session.id)).toEqual(session);
});
