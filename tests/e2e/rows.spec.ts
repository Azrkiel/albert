import { expect, test, type Locator, type Page } from "@playwright/test";
import { PAGE } from "../../src/lib/contracts";

async function draw(page: Page, surface: Locator, row: number) {
  await surface.scrollIntoViewIfNeeded();
  const points = await surface.evaluate((svg, geometry) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!;
    const y = geometry.top + (geometry.row - 1) * geometry.height + 30;
    return [new DOMPoint(100, y), new DOMPoint(300, y)].map((point) => {
      const client = point.matrixTransform(matrix);
      return { x: client.x, y: client.y };
    });
  }, { row, top: PAGE.statementMinHeight, height: PAGE.rowHeight });
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/work/demo-worksheet");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
});

test("shows each statement, four numbered rules, and a separate Albert margin", async ({ page }) => {
  const blocks = page.locator("[data-problem-id]");
  await expect(blocks).toHaveCount(2);
  for (const block of await blocks.all()) {
    await expect(block.getByRole("heading")).toContainText("Problem");
    await expect(block.locator("[data-problem-statement]")).not.toBeEmpty();
    await expect(block.locator("g[data-row-id]")).toHaveCount(4);
    await expect(block.locator("[data-row-number]")).toHaveText(["1", "2", "3", "4"]);
    await expect(block.locator("[data-albert-margin]")).toHaveAttribute("x", String(PAGE.albertCol.x));
    await expect(block.locator("[data-albert-margin]")).toHaveAttribute("fill", "#faf7f2");
    await expect(block.locator("[data-margin-rule]")).toHaveAttribute("x1", String(PAGE.albertCol.x));
  }
});

test("commits row/problem ids, grows only the written problem, and keeps both problems' ink", async ({ page }) => {
  const surfaces = page.getByRole("img", { name: "Worksheet work surface" });
  await draw(page, surfaces.nth(1), 2);
  const secondPath = surfaces.nth(1).locator("[data-stroke-id]");
  const secondGeometry = await secondPath.getAttribute("d");
  await draw(page, surfaces.first(), 4);
  await expect(surfaces.first().locator("g[data-row-id]")).toHaveCount(5);
  await expect(surfaces.nth(1).locator("g[data-row-id]")).toHaveCount(4);
  await expect(surfaces.first().locator("[data-stroke-id]")).toHaveAttribute("data-row-id", "demo-worksheet/p1/r4");
  await expect(surfaces.first().locator("[data-stroke-id]")).toHaveAttribute("data-stroke-problem-id", "demo-worksheet/p1");
  await expect(secondPath).toHaveAttribute("data-row-id", "demo-worksheet/p2/r2");
  await expect(secondPath).toHaveAttribute("data-stroke-problem-id", "demo-worksheet/p2");
  await expect(secondPath).toHaveAttribute("d", secondGeometry!);
  await draw(page, surfaces.first(), 5);
  await expect(surfaces.first().locator("g[data-row-id]")).toHaveCount(6);
});

test("resize preserves ink relative to its rule and subsequent ink uses the same logical row", async ({ page }) => {
  const surface = page.getByRole("img", { name: "Worksheet work surface" }).first();
  await draw(page, surface, 2);
  const ink = surface.locator("[data-stroke-id]").first();
  const path = await ink.getAttribute("d");
  const rule = surface.locator('[data-row-id="demo-worksheet/p1/r2"] line');
  const ruleY = await rule.getAttribute("y1");
  await page.setViewportSize({ width: 620, height: 900 });
  await expect(ink).toHaveAttribute("d", path!);
  await expect(rule).toHaveAttribute("y1", ruleY!);
  await draw(page, surface, 2);
  await expect(surface.locator("[data-stroke-id]")).toHaveCount(2);
  const offsets = await surface.locator("[data-stroke-id]").evaluateAll((paths, ruleY) => paths.map((path) => {
    const box = (path as SVGGraphicsElement).getBBox();
    return { offset: box.y - Number(ruleY), row: path.getAttribute("data-row-id") };
  }), ruleY);
  expect(offsets[0]!.row).toBe("demo-worksheet/p1/r2");
  expect(offsets[1]!.row).toBe(offsets[0]!.row);
  expect(offsets[1]!.offset).toBeCloseTo(offsets[0]!.offset, 0);
});
