import { z } from "zod";
import { CourseFileSchema } from "./course";
import type { Course } from "./course";
import { GitHubSnapshotSchema } from "./storage";

export const FileRefSchema = z.object({ title: z.string(), mime: z.string(), bytes: z.number().int().nonnegative().optional(), url: z.string(), kindGuess: CourseFileSchema.shape.kind, lectureLabel: z.string().optional() });
export type FileRef = z.infer<typeof FileRefSchema>;

export const CourseOutlineSchema = z.object({
  course: z.object({ id: z.string(), title: z.string() }), files: z.array(FileRefSchema),
  units: z.array(z.object({ order: z.number().int().positive(), title: z.string(), sectionId: z.string(), files: z.array(FileRefSchema) })),
  assignments: z.array(z.object({ id: z.string(), title: z.string(), unitOrder: z.number().int().positive().optional(), dueAt: z.iso.datetime({ offset: true }).optional(), fileRefs: z.array(FileRefSchema) })),
});
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;

export interface CourseSourceAdapter {
  readonly source: Course["source"];
  listCourses(): Promise<Array<{ id: string; title: string; shortName?: string }>>;
  getOutline(courseId: string): Promise<CourseOutline>;
  downloadFile(ref: FileRef): Promise<{ bytes: Uint8Array; mime: string }>;
}

export const CourseManifestSchema = z.object({
  version: z.literal(1), course: z.object({ id: z.string(), title: z.string(), shortName: z.string().optional() }),
  units: z.array(z.object({ order: z.number().int().positive(), title: z.string() })),
  files: z.array(z.object({ path: GitHubSnapshotSchema.shape.manifestPath, title: z.string(), mime: z.literal("application/pdf"), kind: CourseFileSchema.shape.kind, unitOrder: z.number().int().positive().optional(), lectureLabel: z.string().optional() })),
  assignments: z.array(z.object({ id: z.string(), title: z.string(), unitOrder: z.number().int().positive(), filePaths: z.array(GitHubSnapshotSchema.shape.manifestPath), dueOffsetDays: z.number().int().optional() })),
}).superRefine((manifest, ctx) => {
  const units = new Set<number>();
  const paths = new Set<string>();
  const assignments = new Set<string>();
  manifest.units.forEach((unit, index) => {
    if (units.has(unit.order)) ctx.addIssue({ code: "custom", path: ["units", index, "order"], message: "Duplicate unit order" });
    units.add(unit.order);
  });
  manifest.files.forEach((file, index) => {
    if (paths.has(file.path)) ctx.addIssue({ code: "custom", path: ["files", index, "path"], message: "Duplicate file path" });
    paths.add(file.path);
    if (file.unitOrder !== undefined && !units.has(file.unitOrder)) ctx.addIssue({ code: "custom", path: ["files", index, "unitOrder"], message: "Unknown unit" });
  });
  manifest.assignments.forEach((assignment, index) => {
    if (assignments.has(assignment.id)) ctx.addIssue({ code: "custom", path: ["assignments", index, "id"], message: "Duplicate assignment id" });
    assignments.add(assignment.id);
    if (!units.has(assignment.unitOrder)) ctx.addIssue({ code: "custom", path: ["assignments", index, "unitOrder"], message: "Unknown unit" });
    assignment.filePaths.forEach((path, fileIndex) => {
      if (!paths.has(path)) ctx.addIssue({ code: "custom", path: ["assignments", index, "filePaths", fileIndex], message: "Unknown file path" });
    });
  });
});
export type CourseManifest = z.infer<typeof CourseManifestSchema>;
