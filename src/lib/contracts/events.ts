import { z } from "zod";
import { StrokeSchema } from "./strokes";
import { AlbertMarkSchema, RungSchema } from "./hints";
import { VerdictSchema } from "./check";

export const STUCK = {
  PAUSE_MIN_MS: 8000, PAUSE_MAX_MS: 20000, PAUSE_FACTOR: 2.5,
  ERASE_LOOP_COUNT: 2, ERASE_LOOP_WINDOW_MS: 45000,
  CROSS_OUT_COVERAGE: 0.6, CROSS_OUT_MIN_LENGTH_RATIO: 1.2,
  REARM_ON: "new_ink", CLUSTER_GAP: 22,
} as const;

export const StuckSignalSchema = z.object({
  kind: z.enum(["pause", "erase_loop", "cross_out", "manual"]),
  problemId: z.string(), rowId: z.string(), at: z.number().nonnegative(),
  detail: z.object({ pauseMs: z.number().nonnegative().optional(), eraseCount: z.number().int().nonnegative().optional(), crossedClusterIds: z.array(z.string()).optional() }).optional(),
});
export type StuckSignal = z.infer<typeof StuckSignalSchema>;

// Events contain hints; requests refer back to stuck signals. Resolve after module initialization.
export const SessionEventSchema = z.lazy(() => z.discriminatedUnion("type", [
  z.object({ type: z.literal("stroke_end"), at: z.number().nonnegative(), stroke: StrokeSchema }),
  z.object({ type: z.literal("erase"), at: z.number().nonnegative(), strokeIds: z.array(z.string()), rowId: z.string() }),
  z.object({ type: z.literal("undo"), at: z.number().nonnegative(), strokeIds: z.array(z.string()), rowId: z.string(), redo: z.literal(true).optional() }),
  z.object({ type: z.literal("stuck"), at: z.number().nonnegative(), signal: StuckSignalSchema }),
  z.object({ type: z.literal("hint_requested"), at: z.number().nonnegative(), hintId: z.string(), rowId: z.string(), rung: RungSchema }),
  z.object({ type: z.literal("hint_shown"), at: z.number().nonnegative(), hintId: z.string(), marks: z.array(AlbertMarkSchema) }),
  z.object({ type: z.literal("check_requested"), at: z.number().nonnegative(), problemId: z.string() }),
  z.object({ type: z.literal("check_result"), at: z.number().nonnegative(), problemId: z.string(), verdict: VerdictSchema }),
  z.object({ type: z.literal("problem_opened"), at: z.number().nonnegative(), problemId: z.string() }),
]));
export type SessionEvent = z.infer<typeof SessionEventSchema>;
