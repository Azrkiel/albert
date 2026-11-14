import { checkIngest } from "../src/lib/agent";
import { closeScriptStore, isMain, openScriptStore } from "./ingest-flat";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { repo, courseId } = await openScriptStore(args);
  const checks = await checkIngest(courseId, repo);
  console.log(`Course: ${courseId}`);
  for (const check of checks) console.log(`${check.number}: ${check.status}${check.status === "skipped" ? ` (${check.detail})` : ` — ${check.detail}`}`);
  if (checks.some(c => c.status === "fail")) process.exitCode = 1;
}
if (isMain(import.meta.url)) main().catch(() => { console.error("Ingest check failed; verify the saved course and state file."); process.exitCode = 1; }).finally(closeScriptStore);
