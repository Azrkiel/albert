import { existsSync } from "node:fs";
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

/**
 * Runs every check the flags allow and returns false if any attempted check failed.
 * `--no-llm` skips the model and vision checks. `--no-source` is accepted now so scripts
 * and the bot can pass it; the course-source check itself arrives with the GitHub adapter (P5.3).
 */
export async function runSmoke(argv: readonly string[]): Promise<boolean> {
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
