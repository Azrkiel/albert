import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getMongoClient, getRepo } from "../src/lib/db";
import { pingModel, pingVision } from "../src/lib/llm";

export async function runDbCheck(): Promise<boolean> {
  const start = performance.now();
  let ok = false;
  try { ok = await getRepo().ping(); } catch { /* Report failure without logging credentials. */ }
  console.log("db", ok ? "ok" : "fail", `${Math.round(performance.now() - start)}ms`);
  return ok;
}

export async function runModelChecks(): Promise<boolean> {
  const model = await pingModel();
  console.log("model", model.ok ? "ok" : "fail", `${model.ms}ms`, model.modelId || "(HINT_MODEL_ID unset)");
  const vision = await pingVision();
  console.log("vision", vision.ok ? "ok" : "fail", `${vision.ms}ms`, vision.answer.replace(/\s+/g, " "));
  return model.ok && vision.ok;
}

export const SNAPSHOT_QUESTION = "Which cluster number is above the term dx in row R2?";

/**
 * The known answer for a snapshot lives beside it in `<name>.md` as a line `answer: 7` (or `answer: 6, 7`
 * when the term spans clusters), with an optional `question:` line overriding the default question.
 */
export function readSnapshotKey(pngPath: string): { question: string; answer: number[] } {
  const note = readFileSync(pngPath.replace(/\.png$/i, ".md"), "utf8");
  const numbers = /^answer:\s*(.+)$/im.exec(note)?.[1]?.match(/\d+/g)?.map(Number) ?? [];
  if (!numbers.length) throw new Error("The snapshot note has no `answer:` line");
  return { question: /^question:\s*(.+)$/im.exec(note)?.[1]?.trim() ?? SNAPSHOT_QUESTION, answer: numbers };
}

/**
 * The reply's last line holds the same integers, in any order: "7" and "Cluster 7" pass for [7]; "6, 7"
 * passes for [6, 7], "6" alone does not. Only the last line counts, because models sometimes reason
 * first ("In row R2 …") even when asked for the number only.
 */
export function sameNumbers(answer: string, expected: readonly number[]): boolean {
  const last = answer.trim().split(/\r?\n/).at(-1) ?? "";
  const got = [...new Set(last.match(/\d+/g)?.map(Number) ?? [])].sort((a, b) => a - b);
  const want = [...new Set(expected)].sort((a, b) => a - b);
  return got.length === want.length && got.every((n, i) => n === want[i]);
}

/** P2.7-AC4: asks the reader model the snapshot's question and checks the known cluster number(s). */
export async function runSnapshotCheck(pngPath: string): Promise<boolean> {
  let key: { question: string; answer: number[] };
  try { key = readSnapshotKey(pngPath); } catch (error) {
    console.log("snapshot", "fail", "0ms", error instanceof Error ? error.message : "no answer key");
    return false;
  }
  const question = `${key.question} Reply with the cluster number only; if the term spans several numbers, list them separated by commas. End with a line holding only the number(s).`;
  const result = await pingVision({ imagePath: pngPath, question, accept: (answer) => sameNumbers(answer, key.answer) });
  console.log("snapshot", result.ok ? "ok" : "fail", `${result.ms}ms`, result.answer.replace(/\s+/g, " "), `(expected ${key.answer.join(", ")})`);
  return result.ok;
}

/**
 * Runs every check the flags allow and returns false if any attempted check failed.
 * `--no-llm` skips the model and vision checks. `--no-source` is accepted now so scripts
 * and the bot can pass it; the course-source check itself arrives with the GitHub adapter (P5.3).
 * `--snapshot <png>` runs only the snapshot question (P2.7-AC4); without it nothing changes.
 */
export async function runSmoke(argv: readonly string[]): Promise<boolean> {
  const snapshot = argv.indexOf("--snapshot");
  if (snapshot !== -1) {
    const png = argv[snapshot + 1];
    if (!png || png.startsWith("--")) { console.log("snapshot", "fail", "0ms", "usage: pnpm smoke --snapshot <png>"); return false; }
    return runSnapshotCheck(png);
  }
  let ok = await runDbCheck();
  if (!argv.includes("--no-llm")) ok = (await runModelChecks()) && ok;
  return ok;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  void runSmoke(process.argv.slice(2)).then(ok => { if (!ok) process.exitCode = 1; }).finally(async () => {
    if ((process.env.STORE || "mongo") === "mongo" && process.env.MONGODB_URI) {
      await getMongoClient(process.env.MONGODB_URI).close();
    }
  });
}
