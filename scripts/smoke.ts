import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { pingModel, pingVision } from "../src/lib/llm";

export async function runModelChecks(): Promise<boolean> {
  const model = await pingModel();
  console.log("model", model.ok ? "ok" : "fail", `${model.ms}ms`, model.modelId || "(HINT_MODEL_ID unset)");
  const vision = await pingVision();
  console.log("vision", vision.ok ? "ok" : "fail", `${vision.ms}ms`, vision.answer.replace(/\s+/g, " "));
  return model.ok && vision.ok;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  if (!process.argv.includes("--no-llm")) {
    void runModelChecks().then((ok) => { if (!ok) process.exitCode = 1; });
  }
}
