import { expect, test, type Page } from "@playwright/test";

// P4.3: marks are drawn by roughjs in `<g class="albert">` above the student's ink.
const problem = 'section[data-problem-id="calc2-ws3/p1"]';
const rowId = "calc2-ws3/p1/r3";

async function hintOnMissingDx(page: Page) {
  await page.goto("/work/calc2-ws3?replay=missing-dx&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  await expect(page.locator(problem).locator("svg[data-capture-ready=true]")).toBeVisible();
  await page.locator(problem).getByRole("button", { name: "Need a hint?", exact: true }).click({ timeout: 25000 });
}

/** Box of the clusters the mock hint names (the whole row's ink when an id is unknown), as targetBox does. */
async function targetBox(page: Page) {
  return page.evaluate((id) => {
    const clusters = window.__albert!.state.clusters[id] ?? [];
    const wanted = new Set([`${id}/c1`, `${id}/c2`]);
    const hit = clusters.filter((c) => wanted.has(c.id));
    const use = hit.length === wanted.size ? hit : clusters;
    const x = Math.min(...use.map((c) => c.bbox.x)), y = Math.min(...use.map((c) => c.bbox.y));
    return { x, y, w: Math.max(...use.map((c) => c.bbox.x + c.bbox.w)) - x, h: Math.max(...use.map((c) => c.bbox.y + c.bbox.h)) - y, named: hit.length };
  }, rowId);
}

const circle = (page: Page) => page.locator(`${problem} g.albert [data-mark-kind="circle"]`);
const arrow = (page: Page) => page.locator(`${problem} g.albert [data-mark-kind="arrow"]`);

test("P4.3-AC1: the circle group's box contains the centre of the target clusters' box", async ({ page }) => {
  await hintOnMissingDx(page);
  await expect(circle(page)).toHaveCount(1, { timeout: 10000 });
  const target = await targetBox(page);
  const box = await circle(page).evaluate((g) => { const b = (g as SVGGraphicsElement).getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  test.info().annotations.push({ type: "target", description: JSON.stringify({ target, box }) });
  expect(cx).toBeGreaterThanOrEqual(box.x);
  expect(cx).toBeLessThanOrEqual(box.x + box.w);
  expect(cy).toBeGreaterThanOrEqual(box.y);
  expect(cy).toBeLessThanOrEqual(box.y + box.h);
  // It wraps the target, not just its centre.
  expect(box.x).toBeLessThan(target.x);
  expect(box.x + box.w).toBeGreaterThan(target.x + target.w);
  // The layer is above the student's ink and takes no pointer events.
  await expect(page.locator(`${problem} g.albert`)).toHaveCSS("pointer-events", "none");
  expect(await page.locator(`${problem} svg[data-capture-ready=true] > *`).evaluateAll((els) =>
    els.findIndex((e) => e.matches("g.albert")) > els.findIndex((e) => e.querySelector("path[data-stroke-id]")))).toBe(true);
});

test("P4.3-AC2: the same hint id draws the same shape twice", async ({ page }) => {
  const shapes = async () => {
    await expect(circle(page)).toHaveCount(1, { timeout: 10000 });
    await expect(arrow(page)).toHaveCount(1, { timeout: 10000 });
    return page.evaluate((sel) => ["circle", "arrow"].map((kind) =>
      [...document.querySelectorAll(`${sel} [data-mark-kind="${kind}"] path`)].map((p) => p.getAttribute("d"))), problem);
  };
  await hintOnMissingDx(page);
  const first = await shapes();
  // A fresh load and the same mock stream: same stream hint id, so the same wobble.
  await hintOnMissingDx(page);
  const second = await shapes();
  expect(first[0]!.length).toBeGreaterThan(0);
  expect(first[1]!.length).toBeGreaterThan(0);
  expect(second).toEqual(first);
});

test("P4.3-AC3: the arrow starts in Albert's column and ends within 12 px of the circle", async ({ page }) => {
  await hintOnMissingDx(page);
  await expect(arrow(page)).toHaveCount(1, { timeout: 10000 });
  const end = await page.evaluate((sel) => {
    const shaft = document.querySelector(`${sel} [data-mark-kind="arrow"] path`) as SVGPathElement;
    const len = shaft.getTotalLength();
    const a = shaft.getPointAtLength(0), b = shaft.getPointAtLength(len);
    const c = (document.querySelector(`${sel} [data-mark-kind="circle"]`) as SVGGraphicsElement).getBBox();
    // Distance from the arrow tip to the circle's ellipse (centre cx, cy; radii from its box).
    const path = document.querySelectorAll(`${sel} [data-mark-kind="circle"] path`);
    let best = Infinity;
    for (const p of path as unknown as SVGPathElement[]) {
      const n = p.getTotalLength();
      for (let i = 0; i <= 400; i++) { const q = p.getPointAtLength(n * i / 400); best = Math.min(best, Math.hypot(q.x - b.x, q.y - b.y)); }
    }
    return { start: { x: a.x, y: a.y }, tip: { x: b.x, y: b.y }, distance: best, circle: { x: c.x, w: c.width } };
  }, problem);
  test.info().annotations.push({ type: "arrow", description: JSON.stringify(end) });
  expect(end.start.x).toBeGreaterThanOrEqual(790);
  expect(end.start.x).toBeLessThanOrEqual(1200);
  expect(end.distance).toBeLessThanOrEqual(12);
});
