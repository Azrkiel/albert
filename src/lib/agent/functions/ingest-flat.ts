import { z } from "zod";
import { OutputParserException } from "@langchain/core/output_parsers";
import type { FileRef, Repo, TeachingCard, Worksheet } from "../../contracts";
import { getRepo } from "../../db";
import { getAdapter } from "../../lms";
import { extractTeachingCard, validateCard } from "./extract-card";
import { extractWorksheet, validateWorksheet } from "./extract-worksheet";
import { readCourseFile, type FileText } from "./read-file";

export function fileIdFromRef(ref: FileRef): string {
  const prefix = "/api/files/";
  if (!ref.url.startsWith(prefix)) throw new Error("Outline file is not a Repo reference; reimport the course source.");
  try { return decodeURIComponent(ref.url.slice(prefix.length)); }
  catch { throw new Error("Invalid cached file reference; reimport the course source."); }
}

type IngestOptions = {
  repo?: Repo; read?: typeof readCourseFile; extractCard?: typeof extractTeachingCard;
  extractWorksheet?: typeof extractWorksheet; checkpoint?: () => Promise<void>; now?: string;
};

export class IngestValidationError extends Error {}

/** One repair, then a visible failure. Never store the invalid candidate. */
async function validated<T>(make: (problems: string[]) => Promise<T>, validate: (value: T) => string[], label: string): Promise<T> {
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = await make(problems);
      problems = validate(value);
      if (!problems.length) return value;
    } catch (error) {
      // Parse/index errors are repairable. Provider/network errors should stop.
      if (error instanceof z.ZodError) problems = error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      else if (error instanceof OutputParserException) problems = ["Structured output did not match the supplied schema. Return every required field with the specified types and valid references."];
      else if (error instanceof Error && /unknown index/.test(error.message)) problems = [error.message];
      else throw error;
    }
  }
  throw new IngestValidationError(`${label} failed validation after one repair:\n${problems.join("\n")}`);
}

export async function ingestFlat(courseId: string, options: IngestOptions = {}): Promise<{ cards: number; worksheets: number }> {
  const repo = options.repo ?? getRepo();
  const course = await repo.getCourse(courseId);
  if (!course) throw new Error("Course is missing; import the course source first.");
  const outline = await (await getAdapter(courseId, repo)).getOutline(courseId);
  const read = options.read ?? readCourseFile;
  const readRef = async (ref: FileRef): Promise<FileText> => {
    const fileId = fileIdFromRef(ref);
    const result = { fileId, lectureLabel: ref.lectureLabel, ...await read(fileId, { repo }) };
    await options.checkpoint?.();
    return result;
  };
  const syllabus: string[] = [];
  for (const ref of outline.files.filter(f => f.kindGuess === "syllabus")) syllabus.push((await readRef(ref)).text);
  const cards: TeachingCard[] = [];
  const worksheets: Worksheet[] = [];
  const units = [...outline.units].sort((a, b) => a.order - b.order);
  for (const item of units) {
    const unit = { id: item.sectionId, courseId, order: item.order, title: item.title };
    const files = item.files.filter(f => f.kindGuess === "lecture_notes" || f.kindGuess === "slides");
    const fileTexts: FileText[] = [];
    for (const file of files) fileTexts.push(await readRef(file));
    const taught = files.length > 0;
    const card = await validated(
      validationProblems => (options.extractCard ?? extractTeachingCard)({ unit, fileTexts, syllabusText: syllabus.join("\n\n"), taught, validationProblems }),
      c => validateCard(c, fileTexts), `Card ${unit.title}`,
    );
    cards.push({ ...card, builtBy: "flat_script" });
  }
  for (const item of units) {
    const unit = { id: item.sectionId, courseId, order: item.order, title: item.title };
    const refs = new Map(item.files.filter(f => f.kindGuess === "worksheet").map(ref => [fileIdFromRef(ref), ref]));
    // Include assignment-linked worksheets even when omitted from unit.files.
    for (const a of outline.assignments.filter(a => a.unitOrder === item.order)) for (const ref of a.fileRefs) refs.set(fileIdFromRef(ref), ref);
    for (const [id, ref] of refs) {
      const { text, pages } = await readRef(ref);
      const file = await repo.getFile(id);
      if (!file) throw new Error(`Missing worksheet ${id}; reimport the course source.`);
      const assignments = outline.assignments.filter(a => a.fileRefs.some(f => fileIdFromRef(f) === id));
      if (assignments.length > 1) throw new Error(`Worksheet ${id} belongs to multiple assignments; resolve the source mapping.`);
      const assignment = assignments[0];
      worksheets.push(await validated(
        validationProblems => (options.extractWorksheet ?? extractWorksheet)({ file: file.meta, text, unit, coveredCards: cards.filter(c => c.order <= unit.order), dueAt: assignment?.dueAt, assignmentId: assignment?.id, validationProblems }),
        ws => [...validateWorksheet(ws, cards), ...ws.problems.filter(p => p.page > pages).map(p => `Problem ${p.label} page exceeds source page count`)],
        `Worksheet ${file.meta.title}`,
      ));
    }
  }
  // All candidates pass before any teaching artifact is written. Stable ids
  // make a second run replace the same records rather than add duplicates.
  for (const card of cards) await repo.upsertCard(card);
  for (const worksheet of worksheets) await repo.upsertWorksheet(worksheet);
  await repo.upsertCourse({ ...course, ingestedAt: options.now ?? new Date().toISOString() });
  await options.checkpoint?.();
  return { cards: cards.length, worksheets: worksheets.length };
}
