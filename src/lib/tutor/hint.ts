import { randomUUID } from "node:crypto";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { AlbertReplySchema, StoredHintSchema, type AlbertReply, type HintEvent, type HintRequest, type Repo, type ScopeBundle } from "../contracts";
import { getRepo } from "../db";
import { checkReply, mapMark, targetClusterIds } from "./ladder";
import { buildMessages } from "./prompt";
import { recordHintEvidence } from "./record-evidence";
import { getScopeBundle } from "./scope";
import { getHintModel } from "./tools";

/** The injected model is already bound to albert_reply, just like getHintModel(). */
export type HintModel = {
  invoke(messages: BaseMessage[], options: { signal: AbortSignal }): Promise<unknown>;
  dispose?: () => void;
};
export type HintDeps = {
  model?: HintModel;
  repo?: Repo;
  scopeLoader?: (worksheetId: string, problemId: string, repo: Repo) => Promise<ScopeBundle>;
  clock?: () => number;
};

const toolOutput = z.object({
  tool_calls: z.array(z.object({ name: z.literal("albert_reply"), args: AlbertReplySchema })).length(1),
  invalid_tool_calls: z.array(z.unknown()).max(0).optional(),
});
const timeoutSetting = z.coerce.number().int().positive().max(2_147_483_647);

export async function* runHint(request: HintRequest, deps: HintDeps = {}): AsyncIterable<HintEvent> {
  const clock = deps.clock ?? Date.now;
  const start = clock();
  const hintId = randomUUID();
  const controller = new AbortController();
  let model = deps.model;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = timeoutSetting.parse(process.env.HINT_TIMEOUT_MS || 12_000);
    // Race as well as abort: a broken provider (or test fake) may ignore the signal.
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Hint deadline exceeded")); }, timeout);
    });
    const withinDeadline = <T>(work: Promise<T>) => Promise.race([work, expired]);
    const repo = deps.repo ?? getRepo();
    const scope = await withinDeadline((deps.scopeLoader ?? getScopeBundle)(request.worksheetId, request.problemId, repo));
    model ??= getHintModel();
    const messages = buildMessages(request, scope);
    let reply: AlbertReply | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Transport errors are not malformed replies and do not consume a repair call.
      const output = await withinDeadline(model.invoke(messages, { signal: controller.signal }));
      const parsed = toolOutput.safeParse(output);
      const candidate = parsed.success ? parsed.data.tool_calls[0]!.args : undefined;
      const violations = candidate ? checkReply(candidate, request, scope) : [
        `Call albert_reply exactly once with valid AlbertReply input. ${parsed.error?.message ?? "Missing tool input."}`,
      ];
      if (candidate && violations.length === 0) { reply = candidate; break; }
      if (attempt === 0) messages.push(new HumanMessage(
        `Your reply failed validation. Return a complete corrected albert_reply call addressing these violations:\n${violations.join("\n")}`,
      ));
    }
    if (!reply) {
      yield { type: "error", hintId, code: "bad_model_output", message: "Albert couldn't read that. Try again?" };
      return;
    }
    // The full model reply is now validated. Stop its deadline before yielding:
    // consumer backpressure must not leave a rejecting timer between events.
    clearTimeout(timer);
    const marks = reply.marks.map((mark) => mapMark(mark, request.rows));
    const diagnosis = reply.diagnosis;
    const wrongRow = request.rows.find((row) => row.index === diagnosis.rowIndex);
    yield { type: "started", hintId, at: start };
    yield { type: "reading", rows: reply.reading.rows.map((row) => ({
      rowId: request.rows.find((target) => target.index === row.index)!.rowId,
      latex: row.latex, confidence: row.confidence,
    })) };
    // Deliberately select public fields; never spread diagnosis into an event.
    yield {
      type: "diagnosis", status: diagnosis.status,
      ...(wrongRow ? { rowId: wrongRow.rowId, clusterIds: targetClusterIds(wrongRow, diagnosis.clusterLabels ?? []) } : {}),
      ...(diagnosis.errorType === undefined ? {} : { errorType: diagnosis.errorType }),
      ...(diagnosis.subskillId === undefined ? {} : { subskillId: diagnosis.subskillId }),
      inScope: true,
    };
    const firstEvent = Math.max(0, clock() - start);
    for (const mark of marks) yield { type: "mark", mark };
    yield { type: "hint", ...reply.hint };
    const ms = { firstEvent, total: Math.max(firstEvent, clock() - start) };
    const stored = StoredHintSchema.parse({
      id: hintId, sessionId: request.sessionId, courseId: scope.card.courseId,
      problemId: request.problemId, rowId: request.rowId, rung: request.rung,
      reading: reply.reading, diagnose: diagnosis, marks, hint: reply.hint, ms,
      at: new Date(start).toISOString(),
    });
    const session = await repo.getSession(request.sessionId);
    if (session && !session.endedAt && session.worksheetId === request.worksheetId && session.courseId === scope.card.courseId) {
      await recordHintEvidence(repo, stored, session);
    } else {
      await repo.saveHint(stored);
    }
    yield { type: "done", hintId, ms };
  } catch {
    // Provider/storage exceptions may contain credentials or private data.
    yield controller.signal.aborted
      ? { type: "error", hintId, code: "timeout", message: "That took too long. Try again?" }
      : { type: "error", hintId, code: "model_unavailable", message: "Albert could not finish this hint. Try again." };
  } finally {
    clearTimeout(timer);
    controller.abort();
    model?.dispose?.();
  }
}
