import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// P4.6: What Albert read, replay of hint_shown, narrow screens, Save page.
const missingDx = 'section[data-problem-id="calc2-ws3/p1"]';
const albert = `${missingDx} g.albert`;

async function open(page: Page, query: string) {
  await page.goto(`/work/calc2-ws3?${query}`);
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  await expect(page.locator(missingDx).locator("svg[data-capture-ready=true]")).toBeVisible();
}
const tapMark = (page: Page) => page.locator(missingDx).getByRole("button", { name: "Need a hint?", exact: true }).click({ timeout: 25000 });
const chip = (page: Page) => page.locator(`${missingDx} [data-albert-chip]`);

test("P4.6-AC1: the row number shows what Albert read, typeset, with its confidence", async ({ page }) => {
  await open(page, "replay=missing-dx&speed=instant");
  const number = page.locator(missingDx).getByRole("button", { name: "Clear row 3 of problem 1" });
  // Before any hint there is nothing to show.
  await number.hover();
  await expect(page.locator(`${missingDx} [data-reading-tip]`)).toHaveCount(0);
  await tapMark(page);
  await expect(chip(page)).toBeVisible({ timeout: 15000 });
  const tip = number.locator("[data-reading-tip]");
  await expect(tip).toBeHidden();
  await number.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("What Albert read (high)");
  await expect(tip.locator("svg path").first()).toBeAttached({ timeout: 5000 }); // typeset by MathJax, not LaTeX source
  expect(await tip.locator("svg path").count()).toBeGreaterThan(8);
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();
  // Keyboard focus shows it too.
  await number.focus();
  await expect(tip).toBeVisible();
});

test("P4.6-AC1: a failed hint leaves no reading behind", async ({ page }) => {
  let first = true;
  await page.route("**/api/hint", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const postData = JSON.stringify(first ? { ...body, fixtureId: "error-mid-stream" } : body);
    first = false;
    await route.continue({ postData });
  });
  await open(page, "replay=missing-dx&speed=instant");
  await tapMark(page);
  await expect(page.locator(`${missingDx} [data-albert-column]`)).toHaveText("That took too long. Try again?", { timeout: 15000 });
  await expect(page.locator(`${missingDx} [data-reading-tip]`)).toHaveCount(0);
});

test("P4.6-AC2: a recording with a hint replays with its marks (instant = final state)", async ({ page }) => {
  let hintRequests = 0;
  page.on("request", (r) => { if (r.url().endsWith("/api/hint")) hintRequests++; });
  await open(page, "replay=with-hint&speed=instant");
  await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(`${albert} [data-mark-kind="arrow"]`)).toHaveCount(1);
  await expect(page.locator(`${albert} [data-ink-segment="citation"]`)).toContainText("Lecture 9");
  await expect(page.locator(`${albert} [data-albert-writing]`)).toContainText("dx");
  // Final state at once: nothing is still being drawn, and no live request was made.
  await expect(page.locator(`${albert} [data-ink-revealing]`)).toHaveCount(0);
  await expect(chip(page)).toHaveCount(0);
  expect(hintRequests).toBe(0);
  expect(await page.evaluate(() => window.__albert!.state.events.filter((e) => e.type === "hint_shown").length)).toBe(1);
});

test("P4.6-AC2: at 4x the replayed marks animate", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/work/calc2-ws3?replay=with-hint&speed=4");
  await page.evaluate(() => {
    const w = window as unknown as { __sawReveal: boolean };
    w.__sawReveal = false;
    const tick = () => { if (document.querySelector("g.albert [data-ink-revealing]")) w.__sawReveal = true; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.waitForFunction(() => window.__albert?.replayDone === true, null, { timeout: 60000 });
  await expect(page.locator(`${albert} [data-ink-segment="citation"]`)).toContainText("Lecture 9", { timeout: 15000 });
  expect(await page.evaluate(() => (window as unknown as { __sawReveal: boolean }).__sawReveal)).toBe(true);
  await expect(page.locator(`${albert} [data-mark-kind="circle"]`)).toHaveCount(1);
});

test("P4.6-AC3: under 900 px the hint is a full-width band under the rows and the arrow points up", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await open(page, "replay=missing-dx&speed=instant");
  await tapMark(page);
  await expect(chip(page)).toBeVisible({ timeout: 15000 });
  const surface = (await page.locator(`${missingDx} svg[data-capture-ready=true]`).boundingBox())!;
  expect(surface.width).toBeLessThanOrEqual(800);
  // Nothing of Albert's overflows the viewport.
  const rects = await page.locator(`${albert} > g, ${missingDx} [data-albert-chip], ${missingDx} [data-albert-clear]`)
    .evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; }));
  expect(rects.length).toBeGreaterThan(2);
  for (const r of rects) { expect(r.l).toBeGreaterThanOrEqual(0); expect(r.r).toBeLessThanOrEqual(800); }
  // In page units: the writing starts below the last row, and the arrow runs upward to the circle.
  const geo = await page.evaluate((sel) => {
    const rows = window.__albert!.state.rows.filter((r) => r.problemId === "calc2-ws3/p1");
    const bottom = Math.max(...rows.map((r) => r.bbox.y + r.bbox.h));
    const w = (document.querySelector(`${sel} [data-albert-writing]`) as SVGGraphicsElement).getBBox();
    const wl = (document.querySelector(`${sel} [data-albert-writing]`) as SVGGraphicsElement).getBBox();
    const shaft = document.querySelector(`${sel} [data-mark-kind="arrow"] path`) as SVGPathElement;
    const start = shaft.getPointAtLength(0), end = shaft.getPointAtLength(shaft.getTotalLength());
    return { bottom, writingTop: w.y, writingLeft: wl.x, startY: start.y, endY: end.y };
  }, albert);
  expect(geo.writingTop).toBeGreaterThanOrEqual(geo.bottom);
  expect(geo.writingLeft).toBeLessThan(100); // the band spans the full width, not Albert's side column
  expect(geo.endY).toBeLessThan(geo.startY);
});

test("P4.6: Save page downloads the problem as an SVG with both inks", async ({ page }) => {
  await open(page, "replay=missing-dx&speed=instant");
  await tapMark(page);
  await expect(chip(page)).toBeVisible({ timeout: 15000 });
  const strokes = await page.locator(`${missingDx} path[data-stroke-id]`).count();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(missingDx).getByRole("button", { name: "Save page" }).click()]);
  expect(download.suggestedFilename()).toBe("problem-1.svg");
  const svg = readFileSync((await download.path())!, "utf8");
  expect(svg.startsWith("<?xml")).toBe(true);
  expect((svg.match(/data-stroke-id=/g) ?? []).length).toBe(strokes);
  expect(svg).toContain('data-mark-kind="circle"');
  expect(svg).toContain("Lecture 9");
  expect(svg).not.toContain("data-live-stroke");
});
