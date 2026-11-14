import { z } from "zod";
import { AlbertMarkSpecSchema, DiagnoseSchema, ReadWorkSchema, RungSchema, WriteHintSchema } from "./hints";
import type { Course, CourseFile, TeachingCard, Worksheet } from "./course";
import type { CourseOutline } from "./lms";
import type { SessionEvent } from "./events";
import type { EvidenceEvent, SkillState } from "./progress";
import type { PlanItem, StudyPlan } from "./plan";
import type { AgentRun } from "./agent";

// Shared by snapshots and manifests; spaces are legal in GitHub filenames.
const repositoryPath = z.string().min(1).refine((path) =>
  !/[\\\u0000-\u001f\u007f:#?%]/.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
"Expected a normalized repository-relative path");

export const GitHubSnapshotSchema = z.object({ owner: z.string(), repo: z.string(), commitSha: z.string().regex(/^[a-f\d]{40}$/i), manifestPath: repositoryPath, demoDay: z.iso.date() });
export type GitHubSnapshot = z.infer<typeof GitHubSnapshotSchema>;

export const CourseConnectionSchema = z.discriminatedUnion("source", [
  z.object({ studentId: z.string(), connectedAt: z.iso.datetime({ offset: true }), source: z.literal("github"), snapshot: GitHubSnapshotSchema, courseId: z.string() }),
  z.object({ studentId: z.string(), connectedAt: z.iso.datetime({ offset: true }), source: z.literal("upload"), courseId: z.string() }),
]);
export type CourseConnection = z.infer<typeof CourseConnectionSchema>;

export const SessionSchema = z.object({ id: z.string(), studentId: z.string(), courseId: z.string(), worksheetId: z.string(), startedAt: z.iso.datetime({ offset: true }), endedAt: z.iso.datetime({ offset: true }).optional() });
export type Session = z.infer<typeof SessionSchema>;

export const StoredHintSchema = z.object({ id: z.string(), sessionId: z.string(), courseId: z.string(), problemId: z.string(), rowId: z.string(), rung: RungSchema, reading: ReadWorkSchema, diagnose: DiagnoseSchema, marks: z.array(AlbertMarkSpecSchema), hint: WriteHintSchema, snapshotFileId: z.string().optional(), ms: z.object({ firstEvent: z.number().nonnegative(), total: z.number().nonnegative() }), at: z.iso.datetime({ offset: true }) });
export type StoredHint = z.infer<typeof StoredHintSchema>;

// Service behavior is a TypeScript interface, not persisted/runtime JSON.
export interface Repo {
  saveConnection(c: CourseConnection): Promise<void>;
  getConnection(studentId: string): Promise<CourseConnection | null>;
  saveOutline(o: CourseOutline): Promise<void>;
  getOutline(courseId: string): Promise<CourseOutline | null>;
  upsertCourse(c: Course): Promise<void>;
  getCourse(id: string): Promise<Course | null>;
  upsertCard(c: TeachingCard): Promise<void>;
  listCards(courseId: string): Promise<TeachingCard[]>;
  upsertWorksheet(w: Worksheet): Promise<void>;
  listWorksheets(courseId: string): Promise<Worksheet[]>;
  getWorksheet(id: string): Promise<Worksheet | null>;
  putFile(meta: CourseFile, bytes: Uint8Array): Promise<void>;
  getFile(id: string): Promise<{ meta: CourseFile; bytes: Uint8Array } | null>;
  createSession(s: Session): Promise<void>;
  appendEvents(sessionId: string, e: SessionEvent[]): Promise<void>;
  endSession(sessionId: string, at: string): Promise<void>;
  saveHint(h: StoredHint): Promise<void>;
  listHints(filter: { sessionId?: string; courseId?: string }): Promise<StoredHint[]>;
  addEvidence(e: EvidenceEvent[]): Promise<void>;
  listEvidence(studentId: string, courseId: string): Promise<EvidenceEvent[]>;
  saveSkills(s: SkillState[]): Promise<void>;
  listSkills(studentId: string, courseId: string): Promise<SkillState[]>;
  savePlan(p: StudyPlan): Promise<void>;
  latestPlan(studentId: string, courseId: string): Promise<StudyPlan | null>;
  setPlanItemStatus(planId: string, itemId: string, status: PlanItem["status"]): Promise<void>;
  saveRun(r: AgentRun): Promise<void>;
  getRun(id: string): Promise<AgentRun | null>;
  ping(): Promise<boolean>;
}
