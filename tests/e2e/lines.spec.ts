import { expect, test, type Locator, type Page } from "@playwright/test";

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
async function state(page: Page) {
  await page.waitForFunction(() => window.__albert !== undefined);
  return page.evaluate(() => window.__albert!.state);
}
const viewHeight = (surface: Locator) => surface.evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.height);

test("P2.5a-AC3: free layout has no rules, numbers lines in visual order and grows below the ink", async ({ page }) => {
  await page.goto("/work/demo-worksheet?layout=free&dev=1");
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await expect(surface).toBeVisible();
  expect((await state(page)).layout).toBe("free");
  await expect(page.locator("[data-problem-id] g[data-row-id]")).toHaveCount(0);
  const startHeight = await viewHeight(surface);

  await draw(page, surface, 100, 520, 220, 530); // written first, lower on the page
  await draw(page, surface, 100, 200, 220, 210);
  await draw(page, surface, 240, 204, 300, 214); // same line as the previous stroke
  const s = await state(page);
  expect(s.rows.filter((r) => r.problemId === "demo-worksheet/p1").map((r) => [r.id, r.index]))
    .toEqual([["demo-worksheet/p1/r2", 1], ["demo-worksheet/p1/r1", 2]]);
  expect(s.strokes.map((st) => st.rowId)).toEqual(["demo-worksheet/p1/r1", "demo-worksheet/p1/r2", "demo-worksheet/p1/r2"]);

  const block = page.locator('[data-problem-id="demo-worksheet/p1"]');
  await expect(block.locator("g[data-row-id] line")).toHaveCount(0);
  // Line 1 (the upper line) is numbered above line 2, whatever the writing order.
  const top = (name: string) => block.getByRole("button", { name, exact: true }).evaluate((el) => el.getBoundingClientRect().top);
  expect(await top("Clear row 1 of problem 1")).toBeLessThan(await top("Clear row 2 of problem 1"));
  await expect(surface.locator("rect[data-line-band]")).toHaveCount(2);

  await draw(page, surface, 100, startHeight - 20, 200, startHeight - 10);
  await expect.poll(() => viewHeight(surface)).toBeGreaterThan(startHeight);
});

test("P2.5a-AC3: clearing an inferred line uses its number, and the ruled layout is still the default", async ({ page }) => {
  await page.goto("/work/demo-worksheet?layout=free");
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await draw(page, surface, 100, 300, 220, 310);
  await page.getByRole("button", { name: "Clear row 1 of problem 1", exact: true }).click();
  await expect(surface.locator("path[data-stroke-id]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear row 1 of problem 1", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(surface.locator("path[data-stroke-id]")).toHaveCount(1);

  await page.goto("/work/demo-worksheet");
  expect((await state(page)).layout).toBe("ruled");
  await expect(page.locator('[data-problem-id="demo-worksheet/p1"] g[data-row-id] line')).toHaveCount(4);
});
