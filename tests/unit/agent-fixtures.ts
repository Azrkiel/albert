import { readFileSync } from "node:fs";
import { TeachingCardSchema, type AgentEvent, type TeachingCard } from "../../src/lib/contracts";
import { CardDraftSchema, type CardDraft } from "../../src/lib/agent/functions/extract-card";
import type { ToolContext } from "../../src/lib/agent/tools";
import { MemoryRepo } from "../../src/lib/db";
import { importGitHubCourse } from "../../src/lib/lms";
import { config, recordedTransport } from "./github-fixtures";

const fixture = (n: number) => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8")));
export const NOW = new Date("2026-11-14T12:00:00Z");

/** Inverse of buildCard for a hand-written fixture card: what the agent would send. */
export function toDraft(card: TeachingCard, files: number): CardDraft {
  const fileIndex = (id: string) => Math.min(Math.max(card.sourceFileIds.indexOf(id), 0), files - 1);
  const methodIndex = (id: string) => card.methods.findIndex((m) => m.id === id);
  const subskillIndex = (id: string) => card.subskills.findIndex((s) => s.id === id);
  return CardDraftSchema.parse({
    title: card.title,
    lectures: card.lectures.map(({ fileId, ...l }) => ({ ...l, fileIndex: fileIndex(fileId) })),
    methods: card.methods.map(({ id, ...m }) => { void id; return m; }),
    notation: card.notation,
    workedExamples: card.workedExamples.map(({ fileId, methodIds, ...e }) => ({ ...e, fileIndex: fileIndex(fileId), methodIndexes: methodIds.map(methodIndex) })),
    conventions: card.conventions,
    pitfalls: card.pitfalls.map(({ subskillId, ...p }) => ({ ...p, subskillIndex: subskillIndex(subskillId) })),
    subskills: card.subskills.map(({ id, ...s }) => { void id; return s; }),
  });
}

export async function setup() {
  const repo = new MemoryRepo();
  const course = await importGitHubCourse(repo, config, { transport: recordedTransport() });
  const outline = (await repo.getOutline(course.id))!;
  const events: AgentEvent[] = [];
  const unit3 = outline.units.find((u) => u.order === 3)!;
  const lectureRefs = unit3.files.filter((f) => f.kindGuess === "lecture_notes");
  const card = fixture(3);
  // The fake reader returns text that supports every label and notation string of the fixture card.
  const text = [...card.lectures.map((l) => l.label), ...card.workedExamples.map((e) => e.label), ...card.notation.map((n) => n.teacherWrites)].join("\n");
  let reads = 0;
  const ctx: ToolContext = {
    courseId: course.id, studentId: "ada", emit: (e) => events.push(e), repo, now: () => NOW,
    getOutline: async () => outline,
    read: async () => { reads++; return { text, pages: 3 }; },
  };
  return { repo, outline, events, ctx, unit3, card, lectureRefs, reads: () => reads };
}
