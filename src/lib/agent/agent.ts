import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend, StoreBackend } from "deepagents";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver, BaseStore } from "@langchain/langgraph";
import { todoListMiddleware } from "langchain";
import { resolve } from "node:path";
import { getChatModel } from "../llm";
import { getAgentRuntime } from "./runtime";
import { ingestSubagents, subagents as courseSubagents } from "./subagents";
import { mainTools } from "./tools";
import type { ToolContext } from "./tools";

/** Tool context plus the injectable pieces; `tools`/`subagents` default to the real ones. */
export type AgentContext = ToolContext & {
  /** Tests inject a fake model; production uses getChatModel("agent"). */
  model?: BaseLanguageModel;
  tools?: StructuredTool[];
  subagents?: NonNullable<Parameters<typeof createDeepAgent>[0]>["subagents"];
  store?: BaseStore;
  checkpointer?: BaseCheckpointSaver;
};

/** Context-only ingest (R1.1): cards, mapped worksheets and /course/scope.md; no planner, no plan. */
export const COURSE_AGENT_PROMPT = `You are Albert's course agent. You learn a course so a tutor can use it as context.
Your job: ingest a course (a teaching card per unit, worksheets mapped to skills, and /course/scope.md). You never build a study plan.
Plan with the todo list. Delegate each unit and each worksheet to the named sub-agents (unit-reader, worksheet-mapper, card-checker) instead of reading documents yourself.
Save results only through the save tools; they check what you give them and return problems that must be fixed.
Files under /course/ and /memories/ persist between runs; anything else is scratch.

Expected shape of an ingestion:
1. Call get_course_outline. Write the todo list: one item per unit, one per worksheet, then "check cards", then "write scope".
2. Delegate every unit to unit-reader (give it the unitId and the unit's lecture file ids; for an upcoming unit with no lecture files, give it the syllabus file id and say the card is names-only). Delegate several units in one step so they run in parallel.
3. Delegate each covered unit (units with lecture files) to card-checker. For each correction it reports, send that unit back to unit-reader once with the corrections, and tell unit-reader to keep everything else unchanged. Do this before any worksheet is mapped, because re-saving a card can renumber its subskill ids.
4. Delegate every worksheet to worksheet-mapper, after the cards are final. If a save_teaching_card result ever lists staleWorksheets, delegate those worksheets to worksheet-mapper again.
5. Write /course/scope.md yourself with write_file (read the cards with list_cards, full:true; do not delegate this and never use the general-purpose agent): a readable summary of methods by unit, the notation table, and what is upcoming.
6. Tick off todos as they finish.
Finish with one line stating the result.`;

/** Kept for the replan runs: the original prompt with the planner. */
export const REPLAN_AGENT_PROMPT = `You are Albert's course agent. You learn a course and plan a student's study.
You have two jobs: ingest a course (a teaching card per unit, worksheets mapped to skills, a first study plan) and build or rebuild a study plan.
Plan with the todo list. Delegate each unit and each worksheet to the named sub-agents (unit-reader, worksheet-mapper, card-checker, planner) instead of reading documents yourself.
Save results only through the save tools; they check what you give them and return problems that must be fixed.
Files under /course/ and /memories/ persist between runs; anything else is scratch.

Expected shape of an ingestion:
1. Call get_course_outline. Write the todo list: one item per unit, one per worksheet, then "check cards", then "first study plan".
2. Delegate every unit to unit-reader (give it the unitId and the unit's lecture file ids; for an upcoming unit with no lecture files, give it the syllabus file id and say the card is names-only). Delegate several units in one step so they run in parallel.
3. Delegate each covered unit (units with lecture files) to card-checker. For each correction it reports, send that unit back to unit-reader once with the corrections, and tell unit-reader to keep everything else unchanged. Do this before any worksheet is mapped, because re-saving a card can renumber its subskill ids.
4. Delegate every worksheet to worksheet-mapper, after the cards are final. If a save_teaching_card result ever lists staleWorksheets, delegate those worksheets to worksheet-mapper again.
5. Write /course/scope.md yourself with write_file (read the cards with list_cards, full:true; do not delegate this and never use the general-purpose agent): a readable summary of methods by unit, the notation table, and what is upcoming.
6. Delegate to planner for the first plan.
7. Tick off todos as they finish.
Finish with one line stating the result.`;

/** Store namespace parts reject periods and colons (and deepagents also limits characters); snapshot-qualified course ids contain / and %. */
export function nsPart(id: string): string {
  return id.replace(/[^A-Za-z0-9@+~-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
}

/** Virtual file layout: scratch in state, memories and course notes in the store, skills from the repo. */
export function courseBackend(ctx: Pick<AgentContext, "studentId" | "courseId">, store?: BaseStore): CompositeBackend {
  return new CompositeBackend(new StateBackend(), {
    "/memories/": new StoreBackend({ store, namespace: () => ["albert", nsPart(ctx.studentId), nsPart(ctx.courseId), "memories"] }),
    "/course/": new StoreBackend({ store, namespace: () => ["albert", "course", nsPart(ctx.courseId)] }),
    "/skills/": new FilesystemBackend({ rootDir: resolve(process.cwd(), "skills"), virtualMode: true }),
  });
}

export async function createCourseAgent(ctx: AgentContext) {
  const runtime = ctx.store && ctx.checkpointer ? { store: ctx.store, checkpointer: ctx.checkpointer } : await getAgentRuntime();
  const { store, checkpointer } = runtime;
  const ingest = ctx.trigger === "ingest";
  return createDeepAgent({
    model: ctx.model ?? getChatModel("agent"),
    systemPrompt: ingest ? COURSE_AGENT_PROMPT : REPLAN_AGENT_PROMPT,
    tools: ctx.tools ?? mainTools(ctx),
    subagents: ctx.subagents ?? (ingest ? ingestSubagents(ctx) : courseSubagents(ctx)),
    middleware: [todoListMiddleware()],
    skills: ["/skills/"],
    memory: ["/memories/AGENTS.md"],
    backend: courseBackend(ctx, store),
    store,
    checkpointer,
  });
}
