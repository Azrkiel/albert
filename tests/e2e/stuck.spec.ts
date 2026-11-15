import { existsSync } from "node:fs";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { PAGE, STUCK } from "../../src/lib/contracts";

async function draw(page: Page, surface: Locator, x: number, y: number) {
  await surface.scrollIntoViewIfNeeded();
  const [from, to] = await surface.evaluate((svg, points) => points.map(([px, py]) => {
    const client = new DOMPoint(px, py).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: client.x, y: client.y };
  }), [[x, y], [x + 15, y + 25]]);
  await page.mouse.move(from!.x, from!.y);
  await page.mouse.down();
  await page.mouse.move(to!.x, to!.y, { steps: 5 });
  await page.mouse.up();
}

async function assertPlacement(page: Page, block: Locator, mark: Locator) {
  const rowId = await mark.getAttribute("data-stuck-row");
  const target = await page.evaluate((id) => window.__albert!.state.rows.find((row) => row.id === id), rowId);
  expect(target).toBeDefined();
  const centre = await block.locator("svg[data-capture-ready=true]").evaluate((svg, { box, x }) => {
    const p = new DOMPoint(x, box.y + box.h / 2).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { y: p.y, scale: (svg as SVGSVGElement).getScreenCTM()!.d };
  }, { box: target!.bbox, x: PAGE.albertCol.x });
  const bounds = (await mark.boundingBox())!;
  expect(Math.abs(bounds.y + bounds.height / 2 - centre.y) / centre.scale).toBeLessThanOrEqual(20);
}

test("P2.6-AC3: recorded pause-row2 mark is within 20 logical px of row 2", async ({ page }) => {
  test.fixme(!existsSync("fixtures/sessions/pause-row2.json"), "needs the recorded pause-row2.json");
  await page.goto("/work/calc2-ws3?replay=pause-row2&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  const row = await page.evaluate(() => window.__albert!.state.rows.find((r) => r.index === 2 && r.problemId === "calc2-ws3/p1")!);
  const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const mark = block.getByRole("button", { name: "Need a hint?", exact: true });
  await expect(mark).toBeVisible({ timeout: 25000 });
  expect(await mark.getAttribute("data-stuck-row")).toBe(row.id);
  await assertPlacement(page, block, mark);
});

for (const layout of ["free", "ruled"]) {
  test(`synthetic ${layout} pause: placement, new ink removal, re-arm and tap to mock hint`, async ({ page }) => {
    test.setTimeout(60000);
    await page.clock.install();
    await page.goto(`/work/calc2-ws3?layout=${layout}`);
    const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
    const surface = block.locator("svg[data-capture-ready=true]");
    await expect(surface).toBeVisible();
    // Real capture with synthetic ink; no file impersonates a human recording.
    for (let i = 0; i < 5; i++) await draw(page, surface, 120 + i * 50, 280);
    await page.clock.runFor(STUCK.PAUSE_MIN_MS + 1100);
    const mark = block.getByRole("button", { name: "Need a hint?", exact: true });
    await expect(mark).toBeVisible();
    await assertPlacement(page, block, mark);
    if (layout === "free") await page.screenshot({ path: test.info().outputPath("stuck-mark.png"), fullPage: true });
    expect(await page.evaluate(() => window.__albert!.state.events.filter((e) => e.type === "stuck").length)).toBe(1);
    await draw(page, surface, 420, 280);
    await expect(mark).toHaveCount(0);
    await page.clock.runFor(STUCK.PAUSE_MAX_MS + 1100);
    await expect(mark).toBeVisible();
    const sent = page.waitForRequest((req) => req.url().endsWith("/api/hint") && req.method() === "POST");
    await mark.click();
    expect((await sent).postDataJSON()).toMatchObject({ problemId: "calc2-ws3/p1", rung: 1, trigger: "pause" });
    await expect(mark).toHaveCount(0);
    await expect(block.locator("[data-albert-column]")).toContainText("Which part of this step needs another look?", { timeout: 15000 }); // mocked stream ~2 s + cold route compile on CI
    await expect(block.locator("[data-albert-column]")).toHaveCSS("color", "rgb(200, 50, 30)");
    await page.clock.runFor(30000);
    await expect(mark).toHaveCount(0);
  });
}

test("I'm stuck requests a manual hint in its problem, including before ruled ink", async ({ page }) => {
  await page.goto("/work/calc2-ws3?layout=ruled");
  const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const manual = block.getByRole("button", { name: "I'm stuck", exact: true });
  await expect(manual).toBeVisible();
  const sent = page.waitForRequest((req) => req.url().endsWith("/api/hint") && req.method() === "POST");
  await manual.click();
  expect((await sent).postDataJSON()).toMatchObject({ rowId: "calc2-ws3/p1/r1", trigger: "manual", rung: 1 });
  await expect(block.locator("[data-albert-column]")).toContainText("Which part of this step needs another look?", { timeout: 15000 }); // mocked stream ~2 s + cold route compile on CI
  expect(await page.evaluate(() => window.__albert!.state.events.some((e) => e.type === "stuck" && e.signal.kind === "manual"))).toBe(true);
});

test("?auto=1 waits 1.5 seconds with the pause mark visible, and new ink cancels it", async ({ page }) => {
  await page.clock.install();
  await page.goto("/work/calc2-ws3?layout=free&auto=1");
  const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const surface = block.locator("svg[data-capture-ready=true]");
  await expect(surface).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await draw(page, surface, 120, 280);
  await page.clock.runFor(STUCK.PAUSE_MAX_MS + 1001);
  const mark = block.getByRole("button", { name: "Need a hint?", exact: true });
  await expect(mark).toBeVisible();
  await page.clock.runFor(1000);
  await expect(block.locator("[data-albert-column]")).toBeEmpty();
  await draw(page, surface, 200, 280);
  await page.clock.runFor(1600);
  await expect(mark).toHaveCount(0);
  await expect(block.locator("[data-albert-column]")).toBeEmpty();
  await page.clock.runFor(STUCK.PAUSE_MAX_MS - 1600 + 1001);
  await expect(mark).toBeVisible();
  const sent: Request[] = [];
  page.on("request", (req) => { if (req.url().endsWith("/api/hint") && req.method() === "POST") sent.push(req); });
  await page.clock.runFor(1000);
  expect(sent).toHaveLength(0);
  // A non-ink event must not restart the mark's visibility delay.
  await page.keyboard.press("Control+z");
  await expect(mark).toBeVisible();
  await page.clock.runFor(501);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.postDataJSON()).toMatchObject({ trigger: "pause", rung: 1 });
  await expect(block.locator("[data-albert-column]")).toContainText("Which part of this step needs another look?", { timeout: 15000 }); // mocked stream ~2 s + cold route compile on CI
});

test("instant replay uses recording duration including trailing pause", async ({ page }) => {
  await page.route("**/api/dev/recording?name=synthetic-in-test", (route) => route.fulfill({
    json: { version: 1, name: "synthetic-in-test", worksheetId: "calc2-ws3", durationMs: 16000,
      problems: [{ id: "calc2-ws3/p1", label: "1", statementLatex: "synthetic" }],
      rows: [{ id: "calc2-ws3/p1/r2", problemId: "calc2-ws3/p1", index: 2, bbox: { x: 0, y: 250, w: 760, h: 90 } }],
      events: Array.from({ length: 5 }, (_, i) => ({ type: "stroke_end", at: 100 + i * 100,
        stroke: { id: `s${i}`, problemId: "calc2-ws3/p1", rowId: "calc2-ws3/p1/r2", tool: "pen", pointerType: "mouse",
          t0: 80 + i * 100, t1: 100 + i * 100, bbox: { x: 100 + i * 40, y: 280, w: 15, h: 25 },
          points: [{ x: 100 + i * 40, y: 280, t: 80 + i * 100, p: 0.5 }, { x: 115 + i * 40, y: 305, t: 100 + i * 100, p: 0.5 }] } })) },
  }));
  await page.goto("/work/calc2-ws3?replay=synthetic-in-test&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  const mark = block.getByRole("button", { name: "Need a hint?", exact: true });
  await expect(mark).toBeVisible();
  await assertPlacement(page, block, mark);
  expect(await page.evaluate(() => window.__albert!.state.events.at(-1)?.at)).toBe(16000);
});

test("production: stuck controls work without recording or inspection hooks", async ({ page }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  await page.clock.install();
  await page.goto("/work/calc2-ws3?dev=1&layout=free");
  const block = page.locator('section[data-problem-id="calc2-ws3/p1"]');
  await expect(page.getByRole("button", { name: "Request mock hint" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => "__albert" in window)).toBe(false);
  await draw(page, block.locator("svg[data-capture-ready=true]"), 120, 280);
  await page.clock.runFor(STUCK.PAUSE_MAX_MS + 1100);
  const mark = block.getByRole("button", { name: "Need a hint?", exact: true });
  await expect(mark).toBeVisible();
  await mark.click();
  await expect(block.locator("[data-albert-column]")).toContainText("Which part of this step needs another look?", { timeout: 15000 }); // mocked stream ~2 s + cold route compile on CI
  await expect(block.getByRole("button", { name: "I'm stuck", exact: true })).toBeVisible();
  expect(await page.evaluate(() => "__albert" in window)).toBe(false);
});
