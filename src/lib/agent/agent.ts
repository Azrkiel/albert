import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend, StoreBackend } from "deepagents";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import { todoListMiddleware } from "langchain";
import { resolve } from "node:path";
import type { AgentEvent } from "../contracts";
import { getChatModel } from "../llm";
import { getAgentRuntime } from "./runtime";

export type AgentContext = {
  studentId: string;
  courseId: string;
  emit: (event: AgentEvent) => void;
  /** Tests inject a fake model; production uses getChatModel("agent"). */
  model?: BaseLanguageModel;
  tools?: StructuredTool[];
  subagents?: NonNullable<Parameters<typeof createDeepAgent>[0]>["subagents"];
  store?: BaseStore;
  checkpointer?: BaseCheckpointSaver;
};

export const COURSE_AGENT_PROMPT = `You are Albert's course agent. You learn a course and plan a student's study.
You have two jobs: ingest a course (a teaching card per unit, worksheets mapped to skills) and build or rebuild a study plan.
Plan with the todo list. Delegate each unit and each worksheet to the named sub-agents instead of reading documents yourself.
Save results only through the save tools; they check what you give them and return problems you must fix.
Files under /course/ and /memories/ persist between runs; anything else is scratch.
Finish with one line stating the result.`;

/** Virtual file layout: scratch in state, memories and course notes in the store, skills from the repo. */
export function courseBackend(ctx: Pick<AgentContext, "studentId" | "courseId">, store?: BaseStore): CompositeBackend {
  return new CompositeBackend(new StateBackend(), {
    "/memories/": new StoreBackend({ store, namespace: () => ["albert", ctx.studentId, ctx.courseId, "memories"] }),
    "/course/": new StoreBackend({ store, namespace: () => ["albert", "course", ctx.courseId] }),
    "/skills/": new FilesystemBackend({ rootDir: resolve(process.cwd(), "skills"), virtualMode: true }),
  });
}

export async function createCourseAgent(ctx: AgentContext) {
  const runtime = ctx.store && ctx.checkpointer ? { store: ctx.store, checkpointer: ctx.checkpointer } : await getAgentRuntime();
  const { store, checkpointer } = runtime;
  return createDeepAgent({
    model: ctx.model ?? getChatModel("agent"),
    systemPrompt: COURSE_AGENT_PROMPT,
    tools: ctx.tools ?? [],
    subagents: ctx.subagents ?? [],
    middleware: [todoListMiddleware()],
    skills: ["/skills/"],
    memory: ["/memories/AGENTS.md"],
    backend: courseBackend(ctx, store),
    store,
    checkpointer,
  });
}
