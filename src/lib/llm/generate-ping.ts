// Run from the repo root: pnpm exec tsx src/lib/llm/generate-ping.ts
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

async function main() {
  const output = resolve("fixtures/eval/ping.png");
  await mkdir(dirname(output), { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 160 }, deviceScaleFactor: 1 });
    await page.setContent('<body style="margin:0;display:grid;place-items:center;height:160px;background:white;color:black;font:64px Arial,sans-serif">2 + 2 = 5</body>');
    await page.screenshot({ path: output });
  } finally {
    await browser.close();
  }
}

void main().catch(() => { console.error("Could not generate fixtures/eval/ping.png"); process.exitCode = 1; });
