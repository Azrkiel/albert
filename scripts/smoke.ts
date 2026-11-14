import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getMongoClient, getRepo } from "../src/lib/db";

export async function runDbCheck(): Promise<boolean> {
  const start = performance.now();
  let ok = false;
  try { ok = await getRepo().ping(); } catch { /* Report failure without logging credentials. */ }
  console.log("db", ok ? "ok" : "fail", `${Math.round(performance.now() - start)}ms`);
  return ok;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  void runDbCheck().then(ok => { if (!ok) process.exitCode = 1; }).finally(async () => {
    if ((process.env.STORE || "mongo") === "mongo" && process.env.MONGODB_URI) {
      await getMongoClient(process.env.MONGODB_URI).close();
    }
  });
}
