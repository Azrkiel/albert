import { z } from "zod";

export const OutcomeSchema = z.enum(["unaided_correct", "correct_after_r1", "correct_after_r2", "correct_after_r3", "error_made", "abandoned"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const EvidenceEventSchema = z.object({ id: z.string(), studentId: z.string(), courseId: z.string(), subskillId: z.string(), problemId: z.string(), sessionId: z.string(), at: z.iso.datetime({ offset: true }), outcome: OutcomeSchema, errorType: z.string().optional(), hintId: z.string().optional() });
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;

export const SkillLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const SkillStateSchema = z.object({ studentId: z.string(), courseId: z.string(), subskillId: z.string(), unitId: z.string(), level: SkillLevelSchema, evidenceIds: z.array(z.string()), recentErrorTypes: z.array(z.string()).max(3), updatedAt: z.iso.datetime({ offset: true }) });
export type SkillState = z.infer<typeof SkillStateSchema>;

export const TutorReportSchema = z.object({
  course: z.object({ id: z.string(), title: z.string() }), student: z.object({ id: z.string(), name: z.string() }),
  period: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }), summary: z.string(),
  totals: z.object({ minutes: z.number().nonnegative(), problemsAttempted: z.number().int().nonnegative(), solvedUnaided: z.number().int().nonnegative(), hintsByRung: z.object({ 1: z.number().int().nonnegative(), 2: z.number().int().nonnegative(), 3: z.number().int().nonnegative() }) }),
  stuckPoints: z.array(z.object({ subskillId: z.string(), subskillName: z.string(), unitTitle: z.string(), errorType: z.string(), count: z.number().int().nonnegative(), lastAt: z.iso.datetime({ offset: true }), example: z.object({ hintId: z.string(), worksheetTitle: z.string(), problemLabel: z.string(), snapshotFileId: z.string().optional(), albertRead: z.string(), albertAsked: z.string(), tutorNote: z.string() }) })),
  skills: z.array(SkillStateSchema.extend({ name: z.string(), unitTitle: z.string() })), suggestedFocus: z.array(z.string()).max(3),
});
export type TutorReport = z.infer<typeof TutorReportSchema>;
