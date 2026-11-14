import { expect, test, type Page } from "@playwright/test";
import { PAGE, type Cluster } from "../../src/lib/contracts";

async function replayDone(page: Page) {
  await page.waitForFunction(() => window.__albert?.replayDone === true);
}

async function liveClusters(page: Page): Promise<Cluster[]> {
  return page.evaluate(() => Object.values(window.__albert!.state.clusters).flat());
}

test("P2.5 dev overlay draws one box and label per cluster of a replayed fixture", async ({ page }) => {
  await page.goto("/work/demo?dev=1&replay=sample&speed=instant");
  await replayDone(page);
  const clusters = await liveClusters(page);
  expect(clusters.length).toBeGreaterThan(0);
  const boxes = page.locator("[data-cluster-overlay] rect[data-cluster-box]");
  await expect(boxes).toHaveCount(clusters.length);
  for (const cluster of clusters) {
    const group = page.locator(`[data-cluster-overlay] [data-cluster-id="${cluster.id}"]`);
    await expect(group.locator("rect[data-cluster-box]")).toHaveCount(1);
    await expect(group.locator("text[data-cluster-label]")).toHaveText(String(cluster.label));
  }
  for (const overlay of await page.locator("[data-cluster-overlay]").all()) {
    expect(await overlay.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  }
});

test("P2.5 overlay is absent without ?dev=1", async ({ page }) => {
  await page.goto("/work/demo?replay=sample&speed=instant");
  await replayDone(page);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(3);
  expect((await liveClusters(page)).length).toBeGreaterThan(0);
  await expect(page.locator("[data-cluster-overlay]")).toHaveCount(0);
  await expect(page.locator("[data-cluster-box]")).toHaveCount(0);
});

test("P2.5 overlay updates live as ink is written and does not block drawing", async ({ page }) => {
  await page.goto("/work/demo-worksheet?dev=1");
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await expect(surface).toBeVisible();
  const boxes = surface.locator("rect[data-cluster-box]");
  await expect(boxes).toHaveCount(0);
  // Two short strokes far apart in row 1, then one drawn starting inside the first box.
  const draw = async (fromX: number, toX: number) => {
    await surface.scrollIntoViewIfNeeded();
    const points = await surface.evaluate((svg, args) => {
      const matrix = (svg as SVGSVGElement).getScreenCTM()!;
      return [args.fromX, args.toX].map((x) => {
        const client = new DOMPoint(x, args.y).matrixTransform(matrix);
        return { x: client.x, y: client.y };
      });
    }, { fromX, toX, y: PAGE.statementMinHeight + 40 });
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 6 });
    await page.mouse.up();
  };
  await draw(100, 160);
  await expect(boxes).toHaveCount(1);
  await draw(400, 460);
  await expect(boxes).toHaveCount(2);
  await draw(120, 150); // starts on top of the first box: the overlay must not swallow it
  await expect(surface.locator("path[data-stroke-id]")).toHaveCount(3);
  await expect(boxes).toHaveCount(2);
  await expect(surface.locator("text[data-cluster-label]")).toHaveText(["1", "2"]);
});
