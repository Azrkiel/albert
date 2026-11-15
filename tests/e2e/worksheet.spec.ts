import { expect, test, type Locator, type Page } from "@playwright/test";
import { PAGE } from "../../src/lib/contracts";

// Synthetic automation through the real UI, not human handwriting.
async function draw(page: Page, surface: Locator, x1: number, y1: number, x2: number, y2: number) {
  await surface.scrollIntoViewIfNeeded();
  const [from, to] = await surface.evaluate((svg, points) => points.map(([x, y]) => {
    const client = new DOMPoint(x, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: client.x, y: client.y };
  }), [[x1, y1], [x2, y2]]);
  await page.mouse.move(from!.x, from!.y);
  await page.mouse.down();
  await page.mouse.move(to!.x, to!.y, { steps: 6 });
  await page.mouse.up();
}

test("P5.6-AC1: all five problems of Worksheet 3 render with a typeset statement and rows", async ({ page }) => {
  await page.goto("/work/calc2-ws3?source=worksheet&layout=ruled");
  const blocks = page.locator("[data-problem-id]");
  await expect(blocks).toHaveCount(5);
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  for (const block of await blocks.all()) {
    await expect(block.locator("[data-problem-statement] svg[data-statement-math]").first()).toBeVisible();
    await expect(block.locator("[data-problem-statement] svg[data-statement-math] path").first()).toBeAttached();
    expect(await block.locator("g[data-row-id]").count()).toBeGreaterThan(0);
  }
  await expect(page.locator("[data-worksheet-title]")).toHaveText("Worksheet 3");
  await expect(page.locator("[data-unit-tag]")).toHaveText("Unit 3 · Trigonometric Substitution");
  await page.screenshot({ path: process.env.WORKSHEET_SHOT ?? "test-results/worksheet.png" });
});

test("P5.6-AC2: ?problem=4 scrolls to and highlights problem 4", async ({ page }) => {
  await page.goto("/work/calc2-ws3?source=worksheet&layout=ruled&problem=4");
  const four = page.locator('[data-problem-id="calc2-ws3/p4"]');
  await expect(four).toHaveAttribute("data-highlighted", "");
  await expect(four).toBeInViewport();
  await expect(page.locator('[data-problem-id="calc2-ws3/p1"]')).not.toBeInViewport();
  await expect(page.locator("[data-highlighted]")).toHaveCount(1);
});

test("P5.6-AC3 (automated part): Original opens a drawer with the cached file in an iframe", async ({ page }) => {
  await page.goto("/work/calc2-ws3?source=worksheet");
  await expect(page.locator("[data-original-drawer]")).toHaveCount(0);
  await page.getByRole("button", { name: "Original", exact: true }).click();
  const frame = page.locator("[data-original-drawer] iframe");
  await expect(frame).toHaveAttribute("src", "/api/files/calc2-worksheet-3");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("[data-original-drawer]")).toHaveCount(0);
});

test("P5.6-AC4: a stroke written under problem 4 carries problem 4's id", async ({ page }) => {
  await page.goto("/work/calc2-ws3?source=worksheet&layout=ruled&problem=4");
  const surface = page.locator('[data-problem-id="calc2-ws3/p4"] svg[data-capture-ready=true]');
  await expect(surface).toBeVisible();
  const y = PAGE.statementMinHeight + PAGE.rowHeight / 2;
  await draw(page, surface, PAGE.studentCol.x + 40, y, PAGE.studentCol.x + 200, y + 6);
  await page.waitForFunction(() => window.__albert !== undefined);
  const strokes = await page.evaluate(() => window.__albert!.state.strokes);
  expect(strokes).toHaveLength(1);
  expect(strokes[0]).toMatchObject({ problemId: "calc2-ws3/p4", rowId: "calc2-ws3/p4/r1" });
});
