import { mkdir, writeFile } from "node:fs/promises";
import { checkIngest, courseBackend, getAgentRuntime, runIngest } from "../src/lib/agent";
import type { AgentRun, Repo } from "../src/lib/contracts";
import { closeScriptStore, flag, isMain, openScriptStore } from "./ingest-flat";

// Usage: agent-ingest.ts --course <id|synthetic> [--source synthetic] [--state path] [--student id] [--check] [--twice]
// Runs the course agent's ingestion (STORE=memory needs --state to keep results between processes), prints each
// event, the elapsed time, and with --check the thirteen golden checks. --twice runs ingestion again on a fresh
// thread and asserts the same card and worksheet ids and counts (no duplicates).
export const INGEST_BUDGET_SECONDS = 360;

async function snapshot(repo: Repo, courseId: string) {
  return {
    cards: (await repo.listCards(courseId)).map((c) => c.unitId).sort(),
    worksheets: (await repo.listWorksheets(courseId)).map((w) => w.id).sort(),
  };
}

async function readScope(courseId: string, studentId: string): Promise<string | null> {
  const { store } = await getAgentRuntime();
  const read = await courseBackend({ studentId, courseId }, store).read("/course/scope.md");
  return typeof read.content === "string" ? read.content : null;
}

function printEvent(e: AgentRun["events"][number]): void {
  console.log(`[${e.type}] ${e.label}${e.detail === undefined ? "" : " " + JSON.stringify(e.detail).slice(0, 200)}`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { repo, courseId, save } = await openScriptStore(args);
  const studentId = flag(args, "--student") || process.env.DEMO_STUDENT_ID?.trim() || "demo";
  const repeats = args.includes("--twice") ? 2 : 1;
  let first: Awaited<ReturnType<typeof snapshot>> | undefined;
  console.log(`Course: ${courseId}`);
  for (let n = 0; n < repeats; n++) {
    const started = Date.now();
    const run = await runIngest(courseId, {
      repo, studentId, onEvent: printEvent,
      // The same thread would resume the earlier conversation; a rerun starts a fresh one.
      ...(n ? { threadId: `ingest:${courseId}:${n + 1}` } : {}),
    });
    await save();
    const seconds = Math.round((Date.now() - started) / 1000);
    const now = await snapshot(repo, courseId);
    console.log(`Run ${n + 1}: ${run.status}; ${now.cards.length} cards, ${now.worksheets.length} worksheets; elapsed ${seconds}s (${seconds < INGEST_BUDGET_SECONDS ? "under" : "OVER"} the ${INGEST_BUDGET_SECONDS}s budget)`);
    await mkdir("work", { recursive: true });
    await writeFile(`work/agent-run-${n + 1}.json`, JSON.stringify(run));
    if (run.status !== "succeeded" || seconds >= INGEST_BUDGET_SECONDS) process.exitCode = 1;
    if (first && JSON.stringify(first) !== JSON.stringify(now)) {
      console.log("Second run changed artifact ids or counts");
      process.exitCode = 1;
    } else if (first) console.log("Second run: same card and worksheet ids and counts; no duplicates");
    first ??= now;
    if (args.includes("--check")) {
      for (const check of await checkIngest(courseId, repo, { run, scopeText: await readScope(courseId, studentId), studentId })) {
        console.log(`${check.number}: ${check.status} — ${check.detail}`);
        if (check.status !== "pass") process.exitCode = 1;
      }
    }
  }
}

if (isMain(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 300) : "Agent ingest failed.");
  process.exitCode = 1;
}).finally(closeScriptStore);
