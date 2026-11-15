import { runAgent } from "../src/lib/agent";
import { closeScriptStore, flag, isMain, openScriptStore } from "./ingest-flat";

// Usage: agent-unit.ts --course <id|synthetic> --unit <order> [--source synthetic] [--state path]
// Asks the course agent to build one unit's card (main agent -> unit-reader -> save_teaching_card).
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { repo, courseId, save } = await openScriptStore(args);
  const order = Number(flag(args, "--unit"));
  if (!Number.isInteger(order) || order < 1) throw new Error("Usage: agent-unit.ts --course <id> --unit <order> [--source synthetic] [--state path]");
  const outline = await repo.getOutline(courseId);
  const unit = outline?.units.find((u) => u.order === order);
  if (!outline || !unit) throw new Error(`Course ${courseId} has no unit ${order}; import the course source first.`);
  console.log(`Course: ${courseId}; unit ${order}: ${unit.title} (${unit.sectionId})`);
  const message = `Build the card for unit ${order} only (unitId ${unit.sectionId}, "${unit.title}"). Delegate it to unit-reader. Do not touch other units, worksheets or the plan.`;
  const run = await runAgent("ingest", courseId, message, {
    repo,
    threadId: `unit:${courseId}:${order}:${Date.now().toString(36)}`,
    onEvent: (e) => console.log(`[${e.type}] ${e.label}${e.detail === undefined ? "" : " " + JSON.stringify(e.detail).slice(0, 240)}`),
  });
  await save();
  const card = (await repo.listCards(courseId)).find((c) => c.unitId === unit.sectionId);
  const starts = run.events.filter((e) => e.type === "subagent_start").length;
  console.log(`status=${run.status} subagent_start=${starts} card=${card ? `${card.title} (${card.methods.length} methods, ${card.workedExamples.length} examples, ${card.subskills.length} subskills, builtBy ${card.builtBy})` : "none"}`);
  if (run.status !== "succeeded" || !card || card.builtBy !== "agent" || starts < 1) process.exitCode = 1;
}

if (isMain(import.meta.url)) main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 300) : "Agent unit run failed.");
  process.exitCode = 1;
}).finally(closeScriptStore);
