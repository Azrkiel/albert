import { z } from "zod";

export const PlanItemSchema = z.object({
  id: z.string(), date: z.iso.date(), worksheetId: z.string(), problemIds: z.array(z.string()), subskillIds: z.array(z.string()),
  lectureRef: z.object({ unitId: z.string(), label: z.string() }).optional(), estMinutes: z.number().min(5).max(45), reason: z.string(),
  evidenceIds: z.array(z.string()), dueAt: z.iso.datetime({ offset: true }).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), status: z.enum(["todo", "done", "skipped"]),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

// Course-dependent plan validity belongs to validatePlan in P6.7.
export const StudyPlanSchema = z.object({ id: z.string(), studentId: z.string(), courseId: z.string(), generatedAt: z.iso.datetime({ offset: true }), trigger: z.enum(["ingest", "session_end", "manual"]), horizonDays: z.literal(7), summary: z.string(), items: z.array(PlanItemSchema) });
export type StudyPlan = z.infer<typeof StudyPlanSchema>;
