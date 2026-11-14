import { setTimeout as sleep } from "node:timers/promises";
import { HintEventSchema, HintRequestSchema, type HintEvent, type HintRequest } from "../../../lib/contracts";
import { loadMockHint, streamMockHint } from "../../../lib/tutor/mock";

// POST handlers are dynamic and use Node by default. cacheComponents forbids
// explicit runtime/dynamic route config in this app.
const headers = { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" };
const line = (event: HintEvent) => JSON.stringify(HintEventSchema.parse(event)) + "\n";

async function* hintEvents(request: HintRequest, signal: AbortSignal): AsyncIterable<HintEvent> {
  if (process.env.MOCK_LLM === "1") {
    yield* streamMockHint(await loadMockHint(request), (ms) => sleep(ms, undefined, { signal }));
  } else {
    // P3.3 replaces this branch with yield* runHint(request).
    yield { type: "error", code: "model_unavailable", message: "Live hints are not available yet." };
  }
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
  let cancelled = false;
  const cleanup = () => request.signal.removeEventListener("abort", abort);
  const stream = new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const next = await events.next();
        if (controller.signal.aborted) { output.close(); cleanup(); return; }
        if (next.done) { output.close(); cleanup(); return; }
        if (next.value.type === "started") hintId = next.value.hintId;
        output.enqueue(encoder.encode(line(next.value)));
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
