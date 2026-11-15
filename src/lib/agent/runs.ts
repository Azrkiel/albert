import { nanoid } from "nanoid";
import type { AgentEvent, AgentRun, Repo } from "../contracts";
import { getRepo } from "../db";
import { createCourseAgent } from "./agent";
import type { AgentContext } from "./agent";
import { createEventMapper } from "./events";
import { agentThreadId } from "./runtime";

export type RunOptions = {
  repo?: Repo;
  studentId?: string;
  threadId?: string;
  onEvent?: (event: AgentEvent) => void;
  now?: () => Date;
  /** Test and script hooks passed through to createCourseAgent. */
  agent?: Pick<AgentContext, "model" | "tools" | "subagents" | "store" | "checkpointer">;
  /** Counts what the run saved, for the final result. */
  summarize?: (repo: Repo, courseId: string, studentId: string) => Promise<NonNullable<AgentRun["result"]>>;
};

const defaultStudent = () => process.env.DEMO_STUDENT_ID?.trim() || "demo";

async function defaultSummary(repo: Repo, courseId: string, studentId: string): Promise<NonNullable<AgentRun["result"]>> {
  const [cards, worksheets, plan] = await Promise.all([repo.listCards(courseId), repo.listWorksheets(courseId), repo.latestPlan(studentId, courseId)]);
  return { cardsSaved: cards.length, worksheetsSaved: worksheets.length, ...(plan ? { planId: plan.id } : {}) };
}

/** Runs the course agent once with one user message; records every event on a stored AgentRun. */
export async function runAgent(kind: AgentRun["kind"], courseId: string, message: string, options: RunOptions = {}): Promise<AgentRun> {
  const repo = options.repo ?? getRepo();
  const now = options.now ?? (() => new Date());
  const studentId = options.studentId ?? defaultStudent();
  const threadId = options.threadId ?? agentThreadId(kind === "ingest" ? "ingest" : "plan", courseId, studentId);
  const run: AgentRun = { id: nanoid(), kind, courseId, studentId, threadId, status: "running", startedAt: now().toISOString(), events: [] };
  const emit = (event: AgentEvent) => { run.events.push(event); options.onEvent?.(event); };
  await repo.saveRun(run);
  try {
    const agent = await createCourseAgent({ studentId, courseId, emit, repo, now, trigger: kind === "ingest" ? "ingest" : message.includes("Trigger: session_end") ? "session_end" : "manual", ...options.agent });
    const map = createEventMapper(now);
    const stream = await agent.stream({ messages: [{ role: "user", content: message }] }, { configurable: { thread_id: threadId }, streamMode: "updates" });
    for await (const chunk of stream) for (const event of map(chunk)) emit(event);
    run.result = await (options.summarize ?? defaultSummary)(repo, courseId, studentId);
    run.status = "succeeded";
    run.endedAt = now().toISOString();
    emit({ at: run.endedAt, type: "note", label: "done", detail: run.result });
  } catch (error) {
    run.status = "failed";
    run.endedAt = now().toISOString();
    // Provider errors can echo credentials; keep only the error class and a bounded message.
    emit({ at: run.endedAt, type: "error", label: error instanceof Error ? error.name : "Error", detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
  }
  await repo.saveRun(run);
  return run;
}

const today = (options: RunOptions) => (options.now ?? (() => new Date()))().toISOString().slice(0, 10);

export function runIngest(courseId: string, options: RunOptions = {}): Promise<AgentRun> {
  return runAgent("ingest", courseId, `Today is ${today(options)}. Ingest course ${courseId}: learn every unit, save a teaching card per unit, map each worksheet to skills, then build the first study plan.`, options);
}

export function runReplan(courseId: string, trigger: string, options: RunOptions = {}): Promise<AgentRun> {
  return runAgent("replan", courseId, `Today is ${today(options)}. Re-plan the study plan for course ${courseId}. Trigger: ${trigger}. Do not re-read course files.`, options);
}
