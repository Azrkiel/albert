import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { HintRequestSchema } from "../src/lib/contracts";

async function main() {
  const port = 3183;
  // Refuse an occupied port so the snapshot cannot come from somebody else's server.
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(port, "localhost", resolve); });
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const require = createRequire(import.meta.url);
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "localhost", "--port", String(port)], {
    cwd: process.cwd(), detached: process.platform !== "win32", stdio: "ignore",
    env: { ...process.env, STORE: "memory", MOCK_LLM: "1", LLM_PROVIDER: "bedrock", NEXT_PUBLIC_AUTO_HINT: "0" },
  });
  const baseURL = `http://localhost:${port}`;
  let spawnError = false;
  server.on("error", () => { spawnError = true; });
  try {
    const deadline = Date.now() + 90_000;
    while (true) {
      if (spawnError || server.exitCode !== null) throw new Error("Snapshot dev server failed to start.");
      try { if ((await fetch(baseURL, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* starting */ }
      if (Date.now() >= deadline) throw new Error("Snapshot dev server did not become ready.");
      await delay(250);
    }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseURL}/work/calc2-ws3?dev=1&replay=missing-dx&speed=instant`);
      await page.waitForFunction(() => window.__albert?.replayDone === true
        && typeof window.__albert.buildHintRequest === "function" && typeof window.__albert.sessionId === "string");
      const request = HintRequestSchema.parse(await page.evaluate(() =>
        window.__albert!.buildHintRequest!("calc2-ws3/p1/r3", 1, "pause"),
      ));
      const target = resolve("fixtures/eval/requests/missing-dx-r1-snapshot.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, JSON.stringify(request, null, 2) + "\n");
      console.log(`Saved ${target} (${request.image.width} × ${request.image.height}, ${request.rows.length} rows). Decode and inspect the marked PNG before a live call.`);
    } finally {
      await browser.close();
    }
  } finally {
    if (server.pid && server.exitCode === null) {
      if (process.platform === "win32") server.kill("SIGTERM");
      else process.kill(-server.pid, "SIGTERM");
    }
  }
}

main().catch(() => { console.error("Snapshot generation failed. Check port 3183 and the Playwright Chromium installation."); process.exitCode = 1; });
