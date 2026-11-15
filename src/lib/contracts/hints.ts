import { z } from "zod";
import { BBoxSchema } from "./geometry";
import { StuckSignalSchema } from "./events";

export const RungSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Rung = z.infer<typeof RungSchema>;

export const QUESTION_MAX_CHARS = 200;
/**
 * A student's typed question: plain text, at most 200 characters after cleaning. Cleaning: every run of
 * whitespace or control characters (newlines, tabs, C0/C1 controls, Unicode line separators) becomes one space,
 * then the ends are trimmed. Empty after cleaning is rejected (omit the field instead). The length limit applies
 * to the cleaned text. Cleaning is not a security boundary: the prompt treats the question as data.
 */
export const questionField = z.string()
  .transform((value) => value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, " ").trim())
  .pipe(z.string().min(1).max(QUESTION_MAX_CHARS));

export const HintTurnSchema = z.object({ hintId: z.string(), rung: RungSchema, rowId: z.string(), text: z.string(), studentWroteAfter: z.boolean(), question: questionField.optional() });
export type HintTurn = z.infer<typeof HintTurnSchema>;

export const HintRequestSchema = z.object({
  sessionId: z.string(), worksheetId: z.string(), problemId: z.string(), rowId: z.string(), rung: RungSchema,
  problemSource: z.enum(["worksheet", "handwriting"]).optional(),
  trigger: z.lazy(() => StuckSignalSchema.shape.kind),
  image: z.object({ marked: z.string(), clean: z.string().optional(), width: z.number().int().positive(), height: z.number().int().positive() }),
  rows: z.array(z.object({ rowId: z.string(), index: z.number().int().positive(), clusterLabels: z.array(z.number().int().positive()) })),
  history: z.array(HintTurnSchema), fixtureId: z.string().optional(),
  question: questionField.optional(),
});
export type HintRequest = z.infer<typeof HintRequestSchema>;

export const ReadWorkSchema = z.object({ rows: z.array(z.object({ index: z.number().int().positive(), latex: z.string(), confidence: z.enum(["high", "medium", "low"]) })) });
export type ReadWork = z.infer<typeof ReadWorkSchema>;

export const DiagnoseSchema = z.object({
  status: z.enum(["error", "on_track", "stalled", "unreadable"]), rowIndex: z.number().int().positive().optional(),
  clusterLabels: z.array(z.number().int().positive()).optional(), errorType: z.string().optional(), subskillId: z.string().optional(), privateNote: z.string(),
  easierOutOfScope: z.object({ methodName: z.string(), unitId: z.string() }).optional(),
});
export type Diagnose = z.infer<typeof DiagnoseSchema>;

export const MarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["circle", "underline", "cross_out"]), rowIndex: z.number().int().positive(), clusterLabels: z.array(z.number().int().positive()) }),
  z.object({ type: z.literal("arrow"), fromHint: z.literal(true), toRowIndex: z.number().int().positive(), toClusterLabels: z.array(z.number().int().positive()) }),
]);
export type Mark = z.infer<typeof MarkSchema>;

export const InkSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }), z.object({ type: z.literal("math"), latex: z.string() }), z.object({ type: z.literal("break") }),
]);
export type InkSegment = z.infer<typeof InkSegmentSchema>;

export const WriteHintSchema = z.object({ kind: z.enum(["question", "nudge", "next_step", "worked_step", "reread"]), segments: z.array(InkSegmentSchema), citation: z.object({ unitId: z.string(), label: z.string() }).optional() });
export type WriteHint = z.infer<typeof WriteHintSchema>;

export const AlbertReplySchema = z.object({ reading: ReadWorkSchema, diagnosis: DiagnoseSchema, marks: z.array(MarkSchema).max(3), hint: WriteHintSchema });
export type AlbertReply = z.infer<typeof AlbertReplySchema>;

export const AlbertMarkSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["circle", "underline", "cross_out"]), rowId: z.string(), clusterIds: z.array(z.string()) }),
  z.object({ type: z.literal("arrow"), toRowId: z.string(), toClusterIds: z.array(z.string()) }),
]);
export type AlbertMarkSpec = z.infer<typeof AlbertMarkSpecSchema>;

export const HintErrorCodeSchema = z.enum(["model_unavailable", "bad_model_output", "timeout", "bad_request"]);
export type HintErrorCode = z.infer<typeof HintErrorCodeSchema>;

export const HintEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), hintId: z.string(), at: z.number().nonnegative() }),
  z.object({ type: z.literal("reading"), rows: z.array(z.object({ rowId: z.string(), latex: z.string(), confidence: z.string() })) }),
  z.object({ type: z.literal("diagnosis"), status: DiagnoseSchema.shape.status, rowId: z.string().optional(), clusterIds: z.array(z.string()).optional(), errorType: z.string().optional(), subskillId: z.string().optional(), inScope: z.boolean(), deferredMethod: z.object({ name: z.string(), unitId: z.string(), unitTitle: z.string() }).optional() }),
  z.object({ type: z.literal("mark"), mark: AlbertMarkSpecSchema }),
  z.object({ type: z.literal("hint"), kind: WriteHintSchema.shape.kind, segments: WriteHintSchema.shape.segments, citation: WriteHintSchema.shape.citation }),
  z.object({ type: z.literal("done"), hintId: z.string(), ms: z.object({ firstEvent: z.number().nonnegative(), total: z.number().nonnegative() }) }),
  z.object({ type: z.literal("error"), hintId: z.string().optional(), code: HintErrorCodeSchema, message: z.string() }),
]);
export type HintEvent = z.infer<typeof HintEventSchema>;

export const AlbertMarkSchema = z.object({
  id: z.string(), hintId: z.string(), problemId: z.string(),
  spec: z.union([AlbertMarkSpecSchema, z.object({ type: z.literal("writing"), rowId: z.string(), segments: z.array(InkSegmentSchema), citation: z.string().optional() })]),
  bbox: BBoxSchema, drawnAt: z.number().nonnegative(),
});
export type AlbertMark = z.infer<typeof AlbertMarkSchema>;
