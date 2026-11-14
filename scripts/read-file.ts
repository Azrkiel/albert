import { access } from "node:fs/promises";
import { readCourseFile } from "../src/lib/agent";
import { closeScriptStore, importLocalPdf, isMain, openScriptStore, sourceFileId } from "./ingest-flat";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const input = args[0];
  if (!input || input.startsWith("--")) throw new Error("Usage: scripts/read-file.ts <path-or-fileId> [--source synthetic] [--state path]");
  const recordedPrefix = "fixtures/github/files/synthetic/";
  const normalized = input.replaceAll("\\", "/");
  const synthetic = normalized.startsWith(recordedPrefix);
  const options = synthetic && !args.includes("--source") ? [...args.slice(1), "--source", "synthetic"] : args.slice(1);
  const { repo, courseId, save } = await openScriptStore(options, true);
  let fileId = synthetic ? sourceFileId(courseId, normalized.slice(recordedPrefix.length)) : input;
  if (!synthetic && !await repo.getFile(input)) {
    try { await access(input); }
    catch { throw new Error(`File ${input} is missing; reimport its course source or provide a local PDF path.`); }
    fileId = await importLocalPdf(repo, input);
  }
  const result = await readCourseFile(fileId, { repo });
  await save();
  console.log(`Pages: ${result.pages}\n${result.text}`);
}
if (isMain(import.meta.url)) main().catch(error => {
  // Local missing-file guidance is safe; provider errors can contain credentials.
  console.error(error instanceof Error && /reimport|Usage:/.test(error.message) ? error.message : "Transcription failed; check reader configuration and PDF limits. No provider error body is printed.");
  process.exitCode = 1;
}).finally(closeScriptStore);
