import { z } from "zod";
import { HintRequestSchema } from "./hints";

// Session events also contain check verdicts; defer the request to break that import cycle.
export const CheckRequestSchema = z.lazy(() => HintRequestSchema.omit({ rung: true, trigger: true, rowId: true }).extend({ finalRowId: z.string() }));
export type CheckRequest = z.infer<typeof CheckRequestSchema>;

export const VerdictSchema = z.enum(["correct", "not_yet", "unreadable"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const CheckResponseSchema = z.object({ verdict: VerdictSchema, reading: z.array(z.object({ rowId: z.string(), latex: z.string() })), firstWrongRowId: z.string().optional(), subskillIds: z.array(z.string()) });
export type CheckResponse = z.infer<typeof CheckResponseSchema>;
