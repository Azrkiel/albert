import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  for (let n = 0; n < 200; n++) {
    const latest = await request.get("/api/session/latest?worksheetId=calc2-ws3");
    if (latest.status() === 404) return;
    const { session } = await latest.json();
    expect((await request.post(`/api/session/${session.id}/end`)).ok()).toBe(true);
  }
  throw new Error("Too many open test sessions");
});
async function setup(page: Page) {
  await page.route("**/api/hint", route => {
    const rowId = route.request().postDataJSON().rows[0].rowId;
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "started", hintId: "pointer-hint", at: 0 },
      { type: "mark", mark: { type: "circle", rowId, clusterIds: [`${rowId}/c1`] } },
      { type: "hint", kind: "question", segments: [{ type: "text", text: "Which part changes?" }] },
      { type: "done", hintId: "pointer-hint", ms: { firstEvent: 1, total: 2 } },
    ].map(e => JSON.stringify(e) + "\n").join("") });
  });
  const metadata = page.waitForResponse(r => r.url().endsWith("/api/files/calc2-worksheet-3/pages"));
  await page.goto("/work/calc2-ws3"); await metadata;
  const svg = page.locator('svg[data-capture-ready=true][data-page="1"]');
  await expect(svg).toBeAttached();
  await svg.evaluate(svg => { const p = new DOMPoint(0, 400).matrixTransform((svg as SVGSVGElement).getScreenCTM()!); window.scrollBy(0, p.y - innerHeight / 2); });
  const points = await svg.evaluate(svg => [new DOMPoint(100, 400), new DOMPoint(160, 430)].map(p => {
    const c = p.matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: c.x, y: c.y };
  }));
  await page.mouse.move(points[0]!.x, points[0]!.y); await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 }); await page.mouse.up();
  await expect(svg.locator("path[data-stroke-id]")).toHaveCount(1);
  return page.locator('[data-pdf-page="1"]');
}

test("R3.4-AC1: the red pen tip reaches the cluster centre before a circle group exists", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const block = await setup(page);
  const arrived = page.waitForFunction(() => {
    const pointer = document.querySelector<SVGGElement>('[data-albert-pointer][data-pointer-arrived="true"]');
    const svg = pointer?.ownerSVGElement;
    if (!pointer || !svg || svg.querySelector('[data-mark-kind="circle"]')) return false;
    const row = window.__albert!.state.strokes[0]!.rowId!;
    const box = window.__albert!.state.clusters[row]![0]!.bbox;
    const matrix = svg.getScreenCTM()!.inverse().multiply(pointer.getScreenCTM()!);
    const tip = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x: tip.x, y: tip.y, targetX: box.x + box.w / 2, targetY: box.y + box.h / 2, circles: svg.querySelectorAll('[data-mark-kind="circle"]').length };
  }, null, { polling: "raf" });
  await block.getByRole("button", { name: "I'm stuck", exact: true }).click();
  const point = await (await arrived).jsonValue();
  if (!point) throw new Error("Pointer did not arrive");
  expect(point.circles).toBe(0);
  expect(Math.hypot(point.x - point.targetX, point.y - point.targetY)).toBeLessThanOrEqual(12);
  await expect(block.locator('[data-mark-kind="circle"]')).toHaveCount(1);
});

test("R3.4: reduced motion never creates a pointer step", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const block = await setup(page);
  await page.evaluate(() => {
    const state = window as unknown as { sawPointer: boolean };
    state.sawPointer = false;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches("[data-albert-pointer]") || node.querySelector("[data-albert-pointer]"))) state.sawPointer = true;
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
  await block.getByRole("button", { name: "I'm stuck", exact: true }).click();
  await expect(block.locator('[data-mark-kind="circle"]')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { sawPointer: boolean }).sawPointer)).toBe(false);
});


test("R3.4: Undo during pointer movement never circles erased work", async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const block = await setup(page);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await block.getByRole("button", { name: "I'm stuck", exact: true }).click();
  await expect(block.locator("[data-albert-pointer]")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__albert!.state.strokes[0]!.erasedAt !== undefined)).toBe(true);
  await page.clock.runFor(3000);
  await expect(block.locator('[data-mark-kind="circle"]')).toHaveCount(0);
  await expect(block.locator("[data-albert-pointer]")).toHaveCount(0);
});
