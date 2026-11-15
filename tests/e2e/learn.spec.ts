import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { AgentRunSchema } from "../../src/lib/contracts";

// R1.2-AC2. The server runs with MOCK_LLM=1, so POST /api/agent/ingest replays fixtures/agent/ingest-run.json.
const courseId = "github:Azrkiel/albert:seed%2Fcalc2%2Fmanifest.json~calc2:abc:2026-11-14";
const worksheets = [1, 2, 3, 4].map(n => ({ id: `${courseId}/f/pdf%2Funit-${n}%2Fworksheet-${n}.pdf/worksheet`, title: `Worksheet ${n}` }));
const context = { cards: 5, worksheets };
const fixture = AgentRunSchema.parse(JSON.parse(readFileSync("fixtures/agent/ingest-run.json", "utf8")));

async function courses(page: Page, ingested: boolean) {
  await page.route("**/api/source/courses", route => route.fulfill({ json: [{ id: courseId, title: "Calculus II", shortName: "Calc 2", ingested }] }));
}

test("idle, learning with progress, then ready with worksheet links", async ({ page }, info) => {
  await courses(page, false);
  let contextCalls = 0;
  await page.route("**/api/agent/context**", route => { contextCalls++; return route.fulfill({ json: context }); });
  await page.goto("/courses");
  const learn = page.getByRole("button", { name: "Learn this course", exact: true });
  await expect(learn).toBeEnabled();
  expect(contextCalls).toBe(0);
  await learn.click();
  const status = page.getByRole("main").getByRole("status");
  await expect(status).toContainText("Learning…");
  await expect(status).toContainText(/\d+ of \d+ steps/, { timeout: 30_000 });
  await expect(status).toContainText(/\d+:\d\d/);
  await page.screenshot({ path: info.outputPath("learning.png") });
  await expect(page.getByText("5 cards · 4 worksheets")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  const links = page.getByRole("link", { name: /^Open Worksheet/ });
  await expect(links).toHaveCount(4);
  for (const [i, w] of worksheets.entries()) await expect(links.nth(i)).toHaveAttribute("href", `/work/${encodeURIComponent(w.id)}`);
  await page.screenshot({ path: info.outputPath("ready.png") });
});

test("a failed run shows Try again and keeps the previous ready list", async ({ page }) => {
  await courses(page, true);
  await page.route("**/api/agent/context**", route => route.fulfill({ json: context }));
  await page.route("**/api/agent/ingest", route => route.fulfill({ status: 503, json: { code: "unavailable", message: "x" } }));
  await page.goto("/courses");
  await expect(page.getByText("5 cards · 4 worksheets")).toBeVisible();
  await page.getByRole("button", { name: "Learn again", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Learning this course failed. Try again.");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  await expect(page.getByText("5 cards · 4 worksheets")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Open Worksheet/ })).toHaveCount(4);
});

test("an error event ends the run as failed", async ({ page }) => {
  await courses(page, false);
  const at = new Date().toISOString();
  await page.route("**/api/agent/ingest", route => route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ at, type: "error", label: "Error" })}\n\n` }));
  await page.goto("/courses");
  await page.getByRole("button", { name: "Learn this course", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Learning this course failed. Try again.");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("a second request attaches to the running run instead of starting another", async ({ request }) => {
  const post = () => request.post("/api/agent/ingest", { data: { courseId }, timeout: 90_000 });
  const first = post();
  await new Promise(resolve => setTimeout(resolve, 1500));
  const second = await post();
  const one = await first;
  expect(one.headers()["content-type"]).toContain("text/event-stream");
  expect(second.headers()["x-run-id"]).toBe(one.headers()["x-run-id"]);
  const count = (body: string) => body.split("\n\n").filter(m => m.startsWith("data:")).length;
  const [a, b] = [await one.text(), await second.text()];
  expect(count(a)).toBe(fixture.events.length);
  expect(count(b)).toBe(count(a));
  // The finished run is readable by id.
  const run = await request.get(`/api/agent/runs/${one.headers()["x-run-id"]}`);
  expect(run.ok()).toBe(true);
  expect(AgentRunSchema.parse(await run.json())).toMatchObject({ status: "succeeded", kind: "ingest" });
  expect((await request.get("/api/agent/runs/nope")).status()).toBe(404);
  expect((await request.post("/api/agent/ingest", { data: {} })).status()).toBe(400);
});
