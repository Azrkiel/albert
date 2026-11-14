import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { TeachingCardSchema } from "../../src/lib/contracts";
import { CardDraftSchema, extractTeachingCard } from "../../src/lib/agent/functions/extract-card";
import { extractWorksheet } from "../../src/lib/agent/functions/extract-worksheet";
const fixture = TeachingCardSchema.parse(JSON.parse(readFileSync("fixtures/cards/calc2-u3.json", "utf8")));
function draft() {
  return CardDraftSchema.parse({ ...fixture,
    lectures: fixture.lectures.map(l => ({ label: l.label, fileIndex: fixture.sourceFileIds.indexOf(l.fileId) })),
    workedExamples: fixture.workedExamples.map(e => ({ ...e, fileIndex: fixture.sourceFileIds.indexOf(e.fileId), methodIndexes: e.methodIds.map(id => fixture.methods.findIndex(m => m.id === id)) })),
    pitfalls: fixture.pitfalls.map(p => ({ ...p, subskillIndex: fixture.subskills.findIndex(s => s.id === p.subskillId) })),
  });
}
function model(value: unknown) {
  const invoke = vi.fn(async (input: unknown) => { void input; return value; });
  const withStructuredOutput = vi.fn(() => ({ invoke }));
  return { invoke, withStructuredOutput, model: { withStructuredOutput } as unknown as Pick<BaseChatModel, "withStructuredOutput"> };
}
const unit = { id: "course/u3", courseId: "course", order: 3, title: fixture.title };
const fileTexts = fixture.sourceFileIds.map((_, n) => ({ fileId: `stored-${n}`, pages: 3, text: "source" }));
it("assigns deterministic ids, source file ids, example method references and pitfall subskills in code", async () => {
  const fake = model(draft());
  const card = await extractTeachingCard({ unit, fileTexts, syllabusText: "syllabus", taught: true, model: fake.model });
  expect(fake.withStructuredOutput).toHaveBeenCalledOnce(); expect(fake.invoke).toHaveBeenCalledOnce();
  expect(card.methods.map(m => m.id)).toEqual(["course/u3.m1", "course/u3.m2"]);
  expect(card.subskills.map(s => s.id)).toEqual(fixture.subskills.map((_, n) => `course/u3.s${n + 1}`));
  expect(card.workedExamples[0]).toMatchObject({ fileId: "stored-0", methodIds: ["course/u3.m1", "course/u3.m2"] });
  expect(card.pitfalls[0]?.subskillId).toBe("course/u3.s2");
  expect(card.sourceFileIds).toEqual(["stored-0", "stored-1"]);
  expect(card.lectures[1]?.fileId).toBe("stored-1");
  expect(card.builtBy).toBe("flat_script");
});
it("builds a taught:false names-only card from the syllabus and includes repair problems", async () => {
  const value = draft(); value.lectures = []; value.workedExamples = []; value.notation = []; value.conventions = []; value.pitfalls = [];
  value.methods = [{ name: "Partial fractions", summary: "", steps: [], lecture: "" }];
  const fake = model(value);
  const card = await extractTeachingCard({ unit: { ...unit, id: "course/u4", order: 4 }, fileTexts: [], syllabusText: "Unit 4: Partial fractions", taught: false, validationProblems: ["Upcoming methods must have zero steps"], model: fake.model });
  expect(card.taught).toBe(false); expect(card.methods[0]?.steps).toEqual([]); expect(card.workedExamples).toEqual([]);
  expect(card.sourceFileIds).toEqual([]);
  expect(JSON.stringify(fake.invoke.mock.calls)).toContain("Upcoming methods must have zero steps");
  expect(JSON.stringify(fake.invoke.mock.calls)).toContain("Unit 4: Partial fractions");
});
it("rejects malformed structured output and nonexistent file indexes", async () => {
  await expect(extractTeachingCard({ unit, fileTexts, syllabusText: "", taught: true, model: model({}).model })).rejects.toThrow();
  const value = draft(); value.workedExamples[0]!.fileIndex = 99;
  await expect(extractTeachingCard({ unit, fileTexts, syllabusText: "", taught: true, model: model(value).model })).rejects.toThrow(/unknown index/);
});
it("extracts worksheet ids in code and attaches supplied file, unit, assignment and due date", async () => {
  const fake = model({ title: "Worksheet 3", problems: [{ label: "1", statementLatex: "\\int x dx", page: 1, subskillIds: ["skill"], methodIds: [] }] });
  const ws = await extractWorksheet({ unit, file: { id: "file", courseId: unit.courseId, title: "ws", mime: "application/pdf", bytes: 1, kind: "worksheet" }, text: "1. integral", coveredCards: [], dueAt: "2026-11-18T23:59:59Z", assignmentId: "assignment", model: fake.model });
  expect(ws).toMatchObject({ id: "file/worksheet", fileId: "file", unitId: unit.id, dueAt: "2026-11-18T23:59:59Z", assignmentId: "assignment", problems: [{ id: "file/worksheet/p1" }] });
  expect(fake.invoke).toHaveBeenCalledOnce();
});
