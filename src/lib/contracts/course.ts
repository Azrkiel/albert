import { z } from "zod";
import { GitHubSnapshotSchema } from "./storage";

export const CourseSchema = z.object({
  id: z.string(), source: z.enum(["github", "upload"]), snapshot: GitHubSnapshotSchema.optional(),
  title: z.string(), shortName: z.string().optional(), ingestedAt: z.iso.datetime({ offset: true }).optional(), unitIds: z.array(z.string()),
}).refine((course) => course.source !== "github" || course.snapshot !== undefined, { path: ["snapshot"], message: "GitHub courses require a pinned snapshot" });
export type Course = z.infer<typeof CourseSchema>;

export const CourseFileSchema = z.object({
  id: z.string(), courseId: z.string(), unitId: z.string().optional(), title: z.string(), mime: z.string(), bytes: z.number().int().nonnegative(),
  kind: z.enum(["lecture_notes", "slides", "worksheet", "syllabus", "other"]), sourceUrl: z.string().optional(), textCacheId: z.string().optional(),
});
export type CourseFile = z.infer<typeof CourseFileSchema>;

export const TeachingCardSchema = z.object({
  unitId: z.string(), courseId: z.string(), order: z.number().int().positive(), title: z.string(), taught: z.boolean(),
  lectures: z.array(z.object({ label: z.string(), fileId: z.string() })),
  methods: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string(), steps: z.array(z.string()), lecture: z.string() })),
  notation: z.array(z.object({ concept: z.string(), teacherWrites: z.string(), avoid: z.array(z.string()), note: z.string().optional() })),
  workedExamples: z.array(z.object({ label: z.string(), problemLatex: z.string(), stepsLatex: z.array(z.string()), methodIds: z.array(z.string()), fileId: z.string(), page: z.number().int().positive() })),
  conventions: z.array(z.string()),
  pitfalls: z.array(z.object({ description: z.string(), subskillId: z.string(), errorType: z.string() })),
  subskills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })).min(3).max(8),
  sourceFileIds: z.array(z.string()), builtBy: z.enum(["agent", "flat_script", "hand"]),
});
export type TeachingCard = z.infer<typeof TeachingCardSchema>;

export const WorksheetSchema = z.object({
  id: z.string(), courseId: z.string(), unitId: z.string(), title: z.string(), fileId: z.string(),
  dueAt: z.iso.datetime({ offset: true }).optional(), assignmentId: z.string().optional(),
  problems: z.array(z.object({ id: z.string(), label: z.string(), statementLatex: z.string(), page: z.number().int().positive(), subskillIds: z.array(z.string()).min(1), methodIds: z.array(z.string()) })),
});
export type Worksheet = z.infer<typeof WorksheetSchema>;

export const ScopeBundleSchema = z.object({
  worksheetId: z.string(), problemId: z.string(), problem: WorksheetSchema.shape.problems.element,
  card: TeachingCardSchema, taught: z.boolean(),
  coveredMethods: z.array(z.object({ id: z.string(), name: z.string(), unitId: z.string(), summary: z.string() })),
  upcomingMethods: z.array(z.object({ name: z.string(), unitId: z.string(), unitTitle: z.string() })),
  notation: TeachingCardSchema.shape.notation,
});
export type ScopeBundle = z.infer<typeof ScopeBundleSchema>;
