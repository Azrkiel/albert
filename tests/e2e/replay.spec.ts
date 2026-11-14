import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PAGE } from "../../src/lib/contracts";

async function replayDone(page: Page) {
  await page.waitForFunction(() => window.__albert?.replayDone === true);
}
async function sample() { return JSON.parse(await readFile("fixtures/sessions/sample.json", "utf8")); }

test("P2.3-AC3: instant fixture replay reproduces all completed paths and session state", async ({ page }) => {
  await page.goto("/work/demo?replay=sample&speed=instant");
  await replayDone(page);
  const rec = await sample();
  const strokes = rec.events.filter((event: { type: string }) => event.type === "stroke_end").map((event: { stroke: unknown }) => event.stroke);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(strokes.length);
  expect(strokes).toHaveLength(3);
  const state = await page.evaluate(() => window.__albert!.state);
  expect(state.strokes).toEqual(strokes);
  expect(state.rows).toEqual(rec.rows);
  expect(state.problems).toEqual(rec.problems);
  for (const path of await page.locator("path[data-stroke-id]").all()) {
    expect(await path.getAttribute("d")).toMatch(/^M/);
  }
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
});

test("export/load round trip replaces ink, repeated loads and pending playback", async ({ page }) => {
  await page.goto("/work/demo?dev=1&replay=sample&speed=instant");
  await replayDone(page);
  const before = await page.evaluate(() => window.__albert!.state);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const exported = JSON.parse(await readFile(path!, "utf8"));
  expect(exported.events).toEqual(before.events);
  await page.getByLabel("Playback speed").selectOption("1");
  await page.getByLabel("Load recording").setInputFiles(path!);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0);
  await page.getByLabel("Playback speed").selectOption("instant");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await replayDone(page);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(before.strokes.length);
  await page.getByLabel("Playback speed").selectOption("1");
  await page.getByLabel("Load recording").setInputFiles(path!);
  await page.getByLabel("Playback speed").selectOption("instant");
  await page.getByLabel("Load recording").setInputFiles(path!);
  await replayDone(page);
  await page.getByLabel("Load recording").setInputFiles(path!);
  await replayDone(page);
  expect((await page.evaluate(() => window.__albert!.state)).strokes).toEqual(before.strokes);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(before.strokes.length);
  await page.waitForTimeout(1200);
  expect((await page.evaluate(() => window.__albert!.state)).events).toEqual(before.events);
  await page.getByLabel("Load recording").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole("alert").filter({ hasText: "Invalid recording" })).toBeVisible();
  expect((await page.evaluate(() => window.__albert!.state)).strokes).toEqual(before.strokes);
});

test("toolbar is opt-in and fixture route rejects traversal, missing files and bad URL names", async ({ page, request }) => {
  await page.goto("/work/demo");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  await page.goto("/work/demo?dev=1");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  for (const name of ["../sample", "..\\sample", "/sample", "sample.json", "%2e%2e%2fsample"]) {
    const response = await request.get(`/api/dev/recording?name=${encodeURIComponent(name)}`);
    expect(response.status()).toBe(400);
  }
  expect((await request.get("/api/dev/recording?name=absent")).status()).toBe(404);
  await page.goto("/work/demo?replay=..%2Fsample&speed=instant");
  await expect(page.getByRole("alert").filter({ hasText: "Could not load recording" })).toBeVisible();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0);
});

test("live capture keeps both problems in one export and one session timeline", async ({ page }) => {
  await page.goto("/work/demo?dev=1");
  const surfaces = page.locator("svg[data-capture-ready=true]");
  await expect(surfaces).toHaveCount(2);
  for (const index of [1, 0]) {
    const surface = surfaces.nth(index);
    await surface.scrollIntoViewIfNeeded();
    // Inside the fourth (last) row, so each problem grows a fifth.
    const y = PAGE.statementMinHeight + 3 * PAGE.rowHeight + 32;
    const points = await surface.evaluate((svg, y) => {
      const matrix = (svg as SVGSVGElement).getScreenCTM()!;
      return [new DOMPoint(100, y), new DOMPoint(200, y + 10)].map((point) => {
        const client = point.matrixTransform(matrix);
        return { x: client.x, y: client.y };
      });
    }, y);
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => window.__albert!.state);
  expect(state.strokes.map((stroke) => stroke.problemId)).toEqual(["demo/p2", "demo/p1"]);
  expect(state.strokes[1]!.t0).toBeGreaterThan(state.strokes[0]!.t1);
  expect(state.rows).toHaveLength(10);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  await page.getByLabel("Playback speed").selectOption("instant");
  await page.getByLabel("Load recording").setInputFiles((await download.path())!);
  await replayDone(page);
  expect((await page.evaluate(() => window.__albert!.state)).strokes).toEqual(state.strokes);
  expect((await page.evaluate(() => window.__albert!.state)).rows).toEqual(state.rows);
});

test("a repeated asynchronous load clears replayDone until the new replay completes", async ({ page }) => {
  await page.goto("/work/demo?dev=1&replay=sample&speed=instant");
  await replayDone(page);
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return read.call(this);
    };
  });
  await page.getByLabel("Load recording").setInputFiles("fixtures/sessions/sample.json");
  await expect.poll(() => page.evaluate(() => window.__albert!.replayDone), { timeout: 500 }).toBe(false);
  await replayDone(page);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(3);
});
