import { randomUUID } from "node:crypto";
import { getRepo } from "../../../lib/db";
import { recordHintEvidence } from "../../../lib/tutor/record-evidence";
import { StoredHintSchema } from "../../../lib/contracts";
import { setTimeout as sleep } from "node:timers/promises";
import { HintEventSchema, HintRequestSchema, type HintEvent, type HintRequest } from "../../../lib/contracts";
import { loadMockHint, streamMockHint } from "../../../lib/tutor/mock";
import { runHint } from "../../../lib/tutor/hint";
import { saveHintSnapshot } from "../../../lib/progress/snapshots";

// POST handlers are dynamic and use Node by default. cacheComponents forbids
// explicit runtime/dynamic route config in this app.
const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" };
const line = (event: HintEvent) => JSON.stringify(HintEventSchema.parse(event)) + "\n";

async function* hintEvents(request: HintRequest, signal: AbortSignal): AsyncIterable<HintEvent> {
  if (process.env.MOCK_LLM === "1") {
    yield* streamMockHint(await loadMockHint(request), (ms) => sleep(ms, undefined, { signal }));
  } else {
    yield* runHint(request);
  }
}

function saveSnapshotAfterDone(input: HintRequest, storedHintId: string) {
  void (async () => {
    try {
      await saveHintSnapshot(getRepo(), { sessionId: input.sessionId, hintId: storedHintId, imageBase64: input.image.marked });
    } catch {
      console.warn("Hint snapshot not saved"); // the hint is already delivered; the report just has no picture
    }
  })();
}

export async function POST(request: Request) {
  let input: HintRequest;
  try {
    input = HintRequestSchema.parse(await request.json());
  } catch {
    return new Response(line({ type: "error", code: "bad_request", message: "Expected a valid HintRequest JSON body." }), { status: 400, headers });
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const events = hintEvents(input, controller.signal)[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let hintId: string | undefined;
  let mockStoredId: string | undefined; // the mock path stores its own hint id
  const collected: HintEvent[] = [];
  let cancelled = false;
  const cleanup = () => request.signal.removeEventListener("abort", abort);
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const next = await events.next();
        if (controller.signal.aborted) { output.close(); cleanup(); return; }
        if (next.done) { output.close(); cleanup(); return; }
        if (next.value.type === "started") hintId = next.value.hintId;
        collected.push(next.value);
        if (next.value.type === "done" && process.env.MOCK_LLM === "1") {
          // P2.8 creates persisted sessions. Until then the dev canvas has none.
          const repo = process.env.STORE === "memory" || process.env.MONGODB_URI ? getRepo() : undefined;
          const session = await repo?.getSession(input.sessionId);
          const worksheet = session ? await repo?.getWorksheet(session.worksheetId) : undefined;
          if (repo && session && !session.endedAt && session.worksheetId === input.worksheetId && worksheet?.courseId === session.courseId && worksheet.problems.some(p => p.id === input.problemId)) {
            const diagnosis = collected.find(e => e.type === "diagnosis");
            const reading = collected.find(e => e.type === "reading");
            const hint = collected.find(e => e.type === "hint");
            if (diagnosis && reading && hint) {
              mockStoredId = JSON.stringify([input.sessionId, hintId, randomUUID()]);
              const stored = StoredHintSchema.parse({
                id: mockStoredId, sessionId: session.id, courseId: session.courseId,
                problemId: input.problemId, rowId: input.rowId, rung: input.rung,
                reading: { rows: reading.rows.map(row => ({ index: input.rows.find(r => r.rowId === row.rowId)?.index ?? 1, latex: row.latex, confidence: row.confidence })) },
                // Public mock streams omit the private note. runHint stores its full live reply itself.
                diagnose: { status: diagnosis.status, subskillId: diagnosis.subskillId, errorType: diagnosis.errorType, privateNote: "" },
                marks: collected.flatMap(e => e.type === "mark" ? [e.mark] : []), hint,
                ms: next.value.ms, at: new Date().toISOString(),
              });
              await recordHintEvidence(repo, stored, session);
            }
          }
        }
        output.enqueue(encoder.encode(line(next.value)));
        // P7.4: only after the hint has been written, never before. Not awaited: it must not slow the hint.
        if (next.value.type === "done") saveSnapshotAfterDone(input, mockStoredId ?? next.value.hintId);
      } catch {
        if (!controller.signal.aborted) {
          output.enqueue(encoder.encode(line({ type: "error", hintId, code: "model_unavailable", message: "Albert could not finish this hint. Try again." })));
        }
        if (!cancelled) output.close();
        cleanup();
      }
    },
    async cancel() {
      cancelled = true;
      abort();
      cleanup();
      await events.return?.();
    },
  });
  return new Response(stream, { status: 200, headers });
}
