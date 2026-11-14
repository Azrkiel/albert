import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import * as llm from "../../src/lib/llm";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import { TeachingCardSchema, type TeachingCard, type Worksheet } from "../../src/lib/contracts";
import type { ExtractCardArgs } from "../../src/lib/agent/functions/extract-card";
import type { ExtractWorksheetArgs } from "../../src/lib/agent/functions/extract-worksheet";
import { MemoryRepo } from "../../src/lib/db";
import { importGitHubCourse } from "../../src/lib/lms";
import { checkIngest, checkIngestData, type IngestData } from "../../src/lib/agent/functions/check-ingest";
import { fileIdFromRef, ingestFlat } from "../../src/lib/agent/functions/ingest-flat";
import type { FileText } from "../../src/lib/agent/functions/read-file";
import { config, recordedTransport } from "./github-fixtures";
import { openScriptStore } from "../../scripts/ingest-flat";

const fixture = (n: number) => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8")));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup() {
  const repo = new MemoryRepo();
  const course = await importGitHubCourse(repo, config, { transport: recordedTransport() });
  const outline = (await repo.getOutline(course.id))!;
  const cards: TeachingCard[] = outline.units.map(unit => {
    const f = fixture(Math.min(unit.order, 4));
    const files = unit.files.filter(f => f.kindGuess === "lecture_notes");
    const remap = new Map(f.sourceFileIds.map((id, n) => [id, fileIdFromRef(files[n]!)]));
    return { ...f, courseId: course.id, unitId: unit.sectionId, title: unit.title, order: unit.order,
      sourceFileIds: [...remap.values()],
      lectures: f.lectures.map(l => ({ ...l, fileId: remap.get(l.fileId)! })),
      workedExamples: f.workedExamples.map(e => ({ ...e, fileId: remap.get(e.fileId)! })),
      ...(unit.order === 5 ? { methods: [{ ...f.methods[0]!, id: "u5.m1", name: "Improper integrals" }], subskills: f.subskills.map((s, n) => ({ ...s, id: `u5.s${n + 1}` })) } : {}),
    };
  });
  // Golden checker inputs are deliberately hand-built, never claimed as live.
  cards[2]!.notation.find(n => n.concept === "new variable")!.teacherWrites = "\\theta";
  cards[2]!.notation.find(n => n.concept === "new variable")!.concept = "angle";
  const sources: FileText[] = [];
  for (const card of cards) for (const fileId of card.sourceFileIds) sources.push({ fileId, pages: 3,
    text: [...card.lectures.filter(l => l.fileId === fileId).map(l => l.label), ...card.workedExamples.filter(e => e.fileId === fileId).map(e => e.label.split(",")[1]), ...card.notation.map(n => n.teacherWrites)].join("\n"),
  });
  const worksheets: Worksheet[] = outline.assignments.map(a => {
    const card = cards.find(c => c.order === a.unitOrder)!;
    const fileId = fileIdFromRef(a.fileRefs[0]!);
    return { id: `${fileId}/worksheet`, fileId, courseId: course.id, unitId: card.unitId, assignmentId: a.id, dueAt: a.dueAt, title: a.title,
      problems: Array.from({ length: a.unitOrder === 3 ? 5 : 3 }, (_, n) => ({ id: `${fileId}/worksheet/p${n + 1}`, label: String(n + 1), statementLatex: "\\int x dx", page: 1, subskillIds: [card.subskills[0]!.id], methodIds: [] })),
    };
  });
  return { repo, course, data: { outline, cards, worksheets, sources } satisfies IngestData };
}
it("golden checks 1–11 pass for a hand-built store, and 12–13 are explicitly skipped", async () => {
  const { repo, course, data } = await setup();
  expect(checkIngestData(data).slice(0, 11).map(c => c.status)).toEqual(Array(11).fill("pass"));
  expect(checkIngestData(data).slice(11).map(c => [c.status, c.detail])).toEqual([["skipped", "agent run, P6.5"], ["skipped", "agent run, P6.5"]]);
  for (const c of data.cards) await repo.upsertCard(c);
  for (const w of data.worksheets) await repo.upsertWorksheet(w);
  for (const s of data.sources) { const file = (await repo.getFile(s.fileId))!; await repo.putText(`${s.fileId}/text`, s.text); await repo.putFile({ ...file.meta, textCacheId: `${s.fileId}/text` }, file.bytes); }
  expect((await checkIngest(course.id, repo)).slice(0, 11).every(c => c.status === "pass")).toBe(true);
});
it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])("golden check %i detects its missing marker", async number => {
  const { data } = await setup();
  switch (number) {
    case 1: data.cards.pop(); break;
    case 2: data.cards[0]!.notation = []; break;
    case 3: data.cards[0]!.methods = []; break;
    case 4: data.cards[2]!.methods[0]!.steps.pop(); break;
    case 5: data.cards[2]!.methods = []; data.cards[2]!.notation = []; break;
    case 6: data.cards[2]!.notation.find(n => n.concept === "angle")!.teacherWrites = "\\phi"; break;
    case 7: data.cards[2]!.workedExamples = []; break;
    case 8: data.cards[2]!.pitfalls = []; break;
    case 9: data.cards[3]!.methods = []; break;
    case 10: data.worksheets[2]!.problems.pop(); break;
    case 11: data.worksheets[2]!.dueAt = "2026-11-19T23:59:59Z"; break;
  }
  expect(checkIngestData(data).find(c => c.number === number)?.status).toBe("fail");
});
it("flat ingest retries once with validation problems, preserves due dates and upserts on rerun without network", async () => {
  const { repo, course, data } = await setup();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
  const read = vi.fn(async (id: string) => {
    const f = (await repo.getFile(id))!;
    return { text: data.sources.find(s => s.fileId === id)?.text ?? "syllabus or worksheet", pages: (await PDFDocument.load(f.bytes)).getPageCount() };
  });
  let cardRetry = false, worksheetRetry = false;
  const extractCard = vi.fn(async (args: ExtractCardArgs) => {
    const card = structuredClone(data.cards.find(c => c.unitId === args.unit.id)!);
    if (args.unit.order === 1 && !cardRetry) { cardRetry = true; card.methods[0]!.steps = ["bad"]; }
    return card;
  });
  const extractWorksheet = vi.fn(async (args: ExtractWorksheetArgs) => {
    const ws = structuredClone(data.worksheets.find(w => w.fileId === args.file.id)!);
    if (!worksheetRetry) { worksheetRetry = true; ws.problems[0]!.statementLatex = ""; }
    return ws;
  });
  for (let n = 0; n < 2; n++) expect(await ingestFlat(course.id, { repo, read, extractCard, extractWorksheet })).toEqual({ cards: 5, worksheets: 4 });
  expect(extractCard.mock.calls[1]![0].validationProblems?.join()).toContain("two");
  expect(extractWorksheet.mock.calls[1]![0].validationProblems?.join()).toContain("statement");
  expect(await repo.listCards(course.id)).toHaveLength(5);
  expect((await repo.listCards(course.id)).every(c => c.builtBy === "flat_script")).toBe(true);
  expect(await repo.listWorksheets(course.id)).toHaveLength(4);
  expect((await repo.getCourse(course.id))?.ingestedAt).toBeDefined();
  expect((await checkIngestData({ ...data, cards: await repo.listCards(course.id), worksheets: await repo.listWorksheets(course.id) })).slice(0, 11).every(c => c.status === "pass")).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it("a second failed validation leaves teaching artifacts and ingestion flag untouched", async () => {
  const { repo, course, data } = await setup();
  const read = vi.fn(async () => ({ text: "source", pages: 3 }));
  const extractCard = vi.fn(async () => ({ ...data.cards[0]!, methods: [] }));
  await expect(ingestFlat(course.id, { repo, read, extractCard })).rejects.toThrow(/after one repair/);
  expect(extractCard).toHaveBeenCalledTimes(2);
  expect(await repo.listCards(course.id)).toEqual([]);
  expect(await repo.listWorksheets(course.id)).toEqual([]);
  expect((await repo.getCourse(course.id))?.ingestedAt).toBeUndefined();
});
it("synthetic import and explicit memory state survive a fresh Repo with no transport calls", async () => {
  vi.stubEnv("STORE", "memory");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
  const dir = await mkdtemp(resolve("../state-test-"));
  const state = join(dir, "state.json");
  try {
    const first = await openScriptStore(["--source", "synthetic", "--state", state]);
    const outline = (await first.repo.getOutline(first.courseId))!, id = fileIdFromRef(outline.units[0]!.files[0]!);
    const file = (await first.repo.getFile(id))!;
    await first.repo.putText("cached-transcription", "cached text");
    await first.repo.putFile({ ...file.meta, textCacheId: "cached-transcription" }, file.bytes);
    await first.save();
    // Simulate a new CLI process by replacing the process-local singleton.
    const shared = globalThis as typeof globalThis & { albertMemoryRepo?: MemoryRepo };
    delete shared.albertMemoryRepo;
    const second = await openScriptStore(["--source", "synthetic", "--state", state]);
    expect(second.repo).not.toBe(first.repo);
    expect(second.courseId).toBe(first.courseId);
    expect(await second.repo.getText("cached-transcription")).toBe("cached text");
    expect((await second.repo.getFile(id))?.meta.textCacheId).toBe("cached-transcription");
    expect(fetch).not.toHaveBeenCalled();
    delete shared.albertMemoryRepo;
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("runs real extractors with a fake structured model and appends repair problems to both prompts", async () => {
  const { repo, course, data } = await setup();
  let badCard = true, badWorksheet = true;
  const prompts: string[] = [];
  const model = {
    withStructuredOutput: (_schema: unknown, options: { name: string }) => {
      void _schema;
      return { invoke: async (messages: BaseMessage[]) => {
        prompts.push(String(messages[0]!.content));
        const input = JSON.parse(String(messages[1]!.content)) as { unit: { id: string }; text?: string };
        const card = data.cards.find(c => c.unitId === input.unit.id)!;
        if (options.name === "worksheet") {
          const problems = [{ label: "1", statementLatex: "\\int x dx", page: 1, subskillIds: [`${card.unitId}.s1`], methodIds: [] }];
          if (badWorksheet) { badWorksheet = false; problems[0]!.statementLatex = " "; }
          return { title: "Worksheet", problems };
        }
        const value = { ...structuredClone(card),
          lectures: card.lectures.map(l => ({ label: l.label, fileIndex: card.sourceFileIds.indexOf(l.fileId) })),
          workedExamples: card.workedExamples.map(e => ({ ...e, fileIndex: card.sourceFileIds.indexOf(e.fileId), methodIndexes: e.methodIds.map(id => card.methods.findIndex(m => m.id === id)) })),
          pitfalls: card.pitfalls.map(p => ({ ...p, subskillIndex: card.subskills.findIndex(s => s.id === p.subskillId) })),
        };
        if (badCard) { badCard = false; value.methods[0]!.steps = ["One step"]; }
        return value;
      } };
    },
  };
  vi.spyOn(llm, "getChatModel").mockReturnValue(model as unknown as BaseChatModel);
  const read = async (id: string) => ({ text: data.sources.find(s => s.fileId === id)?.text ?? "syllabus and worksheet", pages: 3 });
  expect(await ingestFlat(course.id, { repo, read })).toEqual({ cards: 5, worksheets: 4 });
  expect(prompts.some(p => p.includes("Repair these validation problems") && p.includes("two non-empty steps"))).toBe(true);
  expect(prompts.some(p => p.includes("Repair these validation problems") && p.includes("non-empty statement"))).toBe(true);
  expect((await repo.listCards(course.id))[0]!.methods[0]!.id).toBe(`${course.unitIds[0]}.m1`);
});
