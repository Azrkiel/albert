import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AgentEvent } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";
import { getRunRegistry, parseStoredRun, replayRun, runIngest } from "../../../../lib/agent";
import type { LiveRun } from "../../../../lib/agent";

// POST handlers are dynamic and use Node by default. cacheComponents forbids explicit runtime/dynamic route config.
const BodySchema = z.object({ courseId: z.string().min(1) });
const studentId = () => process.env.DEMO_STUDENT_ID?.trim() || "demo";
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const meta = (threadId: string, courseId = "mock") => ({ kind: "ingest", courseId, studentId: studentId(), threadId, startedAt: new Date().toISOString() }) as const;
const failed = (live: LiveRun) => { live.emit({ at: new Date().toISOString(), type: "error", label: "Error" }); live.end("failed"); };

/** The run keeps going if the browser goes away; the registry holds it for the next request. */
async function startRun(courseId: string, key: string): Promise<LiveRun> {
  const registry = getRunRegistry();
  if (process.env.MOCK_LLM === "1") {
    const live = registry.start(key, nanoid(), meta("mock", courseId));
    void (async () => {
      try {
        const stored = parseStoredRun(JSON.parse(await readFile(resolve("fixtures/agent/ingest-run.json"), "utf8")));
        live.end(await replayRun(stored, (e) => live.emit(e), (ms) => sleep(ms), () => new Date().toISOString()));
      } catch { failed(live); }
    })();
    return live;
  }
  // runIngest creates the run id; the registry entry is made as soon as it is known.
  return new Promise<LiveRun>((resolveLive, reject) => {
    let live: LiveRun | undefined;
    runIngest(courseId, {
      studentId: studentId(),
      // A repeat ingest starts a fresh conversation, as the script does for its second run.
      threadId: `ingest:${courseId}:${nanoid(8)}`,
      onStart: (run) => { live = registry.start(key, run.id, { kind: "ingest", courseId, studentId: run.studentId, threadId: run.threadId, startedAt: run.startedAt }); resolveLive(live); },
      onEvent: (event) => live?.emit(event),
    }).then((run) => live?.end(run.status === "failed" ? "failed" : "succeeded"), () => { if (live) failed(live); else reject(new Error("Could not start the run.")); });
  });
}

export async function POST(request: Request) {
  let courseId: string;
  try { courseId = BodySchema.parse(await request.json()).courseId; }
  catch { return json({ code: "bad_request", message: "Expected { courseId }." }, 400); }
  const key = `${studentId()}:${courseId}`;
  let live = getRunRegistry().find(key);
  // Only a running run is attached to; a finished one starts a new run.
  if (!live || live.status !== "running") {
    try {
      if (process.env.MOCK_LLM !== "1" && !(await getRepo().getCourse(courseId))) return json({ code: "not_found", message: "Course not found. Import it first." }, 404);
      live = await startRun(courseId, key);
    } catch { return json({ code: "unavailable", message: "Could not start learning this course." }, 503); }
  }
  return stream(live, request.signal);
}

function stream(live: LiveRun, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: AgentEvent) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* client gone */ } };
      const close = () => { try { controller.close(); } catch { /* already closed */ } };
      unsubscribe = live.subscribe(send, close);
      signal.addEventListener("abort", () => { unsubscribe(); close(); }, { once: true });
    },
    cancel() { unsubscribe(); },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "X-Run-Id": live.runId } });
}
