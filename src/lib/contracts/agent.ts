import { z } from "zod";

export const AgentEventSchema = z.object({ at: z.iso.datetime({ offset: true }), type: z.enum(["todo", "subagent_start", "subagent_end", "tool", "file", "note", "error"]), label: z.string(), detail: z.unknown().optional() });
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AgentRunSchema = z.object({ id: z.string(), kind: z.enum(["ingest", "replan"]), courseId: z.string(), studentId: z.string(), threadId: z.string(), status: z.enum(["running", "succeeded", "failed"]), startedAt: z.iso.datetime({ offset: true }), endedAt: z.iso.datetime({ offset: true }).optional(), events: z.array(AgentEventSchema), result: z.object({ cardsSaved: z.number().int().nonnegative().optional(), worksheetsSaved: z.number().int().nonnegative().optional(), planId: z.string().optional() }).optional() });
export type AgentRun = z.infer<typeof AgentRunSchema>;
