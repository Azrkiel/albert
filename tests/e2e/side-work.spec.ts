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
  await page.mouse.move(to!.x, to!.y, { steps: 12 });
  await page.mouse.up();
}
async function state(page: Page) {
  await page.waitForFunction(() => window.__albert !== undefined);
  return page.evaluate(() => window.__albert!.state);
}

test("P2.5b-AC2: side work right of a divider gets its own numbered line at the same height", async ({ page }) => {
  await page.goto("/work/demo-worksheet?layout=free&dev=1");
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await expect(surface).toBeVisible();
  await draw(page, surface, 100, 200, 300, 210);   // main work
  await draw(page, surface, 420, 150, 421, 480);   // divider
  await draw(page, surface, 460, 205, 600, 215);   // side work, same height
  await draw(page, surface, 310, 202, 380, 212);   // main work continued, left of the divider
  const s = await state(page);
  const rowOf = (i: number) => s.strokes[i]!.rowId;
  expect(rowOf(3)).toBe(rowOf(0));
  expect(new Set([rowOf(0), rowOf(1), rowOf(2)]).size).toBe(3);

  const block = page.locator('[data-problem-id="demo-worksheet/p1"]');
  const buttons = block.getByRole("button", { name: /^Clear row \d of problem 1$/ });
  await expect(buttons).toHaveText(["1", "2"]); // the divider is not numbered
  const left = (name: string) => block.getByRole("button", { name, exact: true }).evaluate((el) => el.getBoundingClientRect().left);
  expect(await left("Clear row 2 of problem 1")).toBeGreaterThan(await left("Clear row 1 of problem 1") + 100);
  await expect(surface.locator("rect[data-line-band]")).toHaveCount(3);
  // Main: two clusters (10 px apart > CLUSTER_GAP); side: one; the divider: none.
  await expect(surface.locator("rect[data-cluster-box]")).toHaveCount(3);
});
