import { z } from "zod";
import { RowSchema } from "./strokes";
import { SessionEventSchema } from "./events";
import { DiagnoseSchema, HintEventSchema, HintTurnSchema, questionField, RungSchema, WriteHintSchema } from "./hints";

export const SessionRecordingSchema = z.object({ version: z.literal(1), name: z.string(), worksheetId: z.string(), problems: z.array(z.object({ id: z.string(), label: z.string(), statementLatex: z.string() })), rows: z.array(RowSchema), events: z.array(SessionEventSchema), durationMs: z.number().nonnegative(), notes: z.string().optional(), layout: z.enum(["ruled", "free"]).optional() });
export type SessionRecording = z.infer<typeof SessionRecordingSchema>;
/** Absent on a recording means "ruled". */
export type CanvasLayout = NonNullable<SessionRecording["layout"]>;

export const MockHintSchema = z.object({ fixtureId: z.string(), events: z.array(HintEventSchema), delaysMs: z.array(z.number().nonnegative()) }).refine((mock) => mock.events.length === mock.delaysMs.length, { path: ["delaysMs"], message: "One delay is required per event" });
export type MockHint = z.infer<typeof MockHintSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(), recording: z.string().optional(), request: z.string().optional(), worksheetId: z.string(), problemId: z.string(), stuckRowIndex: z.number().int().positive(), rung: RungSchema, history: z.array(HintTurnSchema).optional(), question: questionField.optional(),
  expect: z.object({ status: z.array(DiagnoseSchema.shape.status), stuckRowLatex: z.string().optional(), errorRowIndex: z.number().int().positive().optional(), errorClusterLabels: z.array(z.number().int().positive()).optional(), errorType: z.string().optional(), kind: z.array(WriteHintSchema.shape.kind).optional(), mustNotMention: z.array(z.string()).optional(), mustMentionAny: z.array(z.string()).optional(), citationIncludes: z.string().optional(), forbiddenMethods: z.array(z.string()).optional() }),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;
