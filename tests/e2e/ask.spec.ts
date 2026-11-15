import { expect, test, type Page, type Route } from "@playwright/test";
import type { HintRequest } from "../../src/lib/contracts";
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
  await page.emulateMedia({ reducedMotion: "reduce" });
  const ready = page.waitForResponse(r => r.url().endsWith("/api/files/calc2-worksheet-3/pages"));
  await page.goto("/work/calc2-ws3"); await ready;
  await expect(page.locator('svg[data-capture-ready=true]')).toHaveCount(2);
  return page.locator('[data-pdf-page="1"]');
}
async function reply(route: Route, text: string, id: string) {
  await route.fulfill({ contentType: "application/x-ndjson", body: [
    { type: "started", hintId: id, at: 0 },
    { type: "hint", kind: "question", segments: [{ type: "text", text }] },
    { type: "done", hintId: id, ms: { firstEvent: 1, total: 2 } },
  ].map(e => JSON.stringify(e) + "\n").join("") });
}
async function draw(page: Page) {
  const svg = page.locator('svg[data-capture-ready=true][data-page="1"]');
  await svg.evaluate(svg => { const p = new DOMPoint(0, 400).matrixTransform((svg as SVGSVGElement).getScreenCTM()!); window.scrollBy(0, p.y - innerHeight / 2); });
  const pts = await svg.evaluate(svg => [new DOMPoint(100, 400), new DOMPoint(160, 430)].map(p => {
    const c = p.matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: c.x, y: c.y };
  }));
  await page.mouse.move(pts[0]!.x, pts[0]!.y); await page.mouse.down();
  await page.mouse.move(pts[1]!.x, pts[1]!.y, { steps: 4 }); await page.mouse.up();
  await expect(svg.locator("path[data-stroke-id]")).toHaveCount(1);
}
test("R3.2-AC1: before-ink question, drawn reply, new ink and follow-up survive reload", async ({ page }) => {
  const requests: HintRequest[] = [];
  await page.route("**/api/hint", async route => { requests.push(route.request().postDataJSON()); await reply(route, `Reply ${requests.length}`, `h${requests.length}`); });
  let block = await setup(page);
  const field = () => block.getByPlaceholder("Ask Albert…");
  await field().fill("Why dx?"); await field().press("Enter");
  await expect(block.locator(".albert")).toContainText(/Reply\s*1/);
  expect(requests[0]!.question).toBe("Why dx?");
  await expect(block.locator('[data-mark-kind="circle"], [data-albert-pointer]')).toHaveCount(0);
  await draw(page);
  await page.keyboard.press("Control+z");
  await expect.poll(() => page.evaluate(() => window.__albert!.state.strokes[0]!.erasedAt !== undefined)).toBe(true);
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => page.evaluate(() => window.__albert!.state.strokes[0]!.erasedAt === undefined)).toBe(true);
  await field().fill("And now?"); await field().press("Enter");
  await expect(block.locator(".albert")).toContainText(/Reply\s*2/);
  expect(requests[1]!.history[0]).toMatchObject({ question: "Why dx?", text: "Reply 1", studentWroteAfter: true });
  // Flush through the normal sync path before navigating.
  await expect.poll(async () => { const r = await page.request.get("/api/session/latest?worksheetId=calc2-ws3"); return (await r.json()).events.filter((e: { type: string }) => e.type === "hint_shown").length; }).toBe(2);
  await page.reload(); block = page.locator('[data-pdf-page="1"]');
  await expect(block.locator(".albert")).toContainText(/Reply\s*2/);
  await field().fill("What next?"); await field().press("Enter");
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]!.history.map(h => h.question)).toEqual(["Why dx?", "And now?"]);
});
test("R3.2-AC1: a replacement cancels the held first stream and never draws its reply", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  await page.route("**/api/hint", async route => {
    if (++count === 1) { await held; await reply(route, "Obsolete answer", "old").catch(() => {}); }
    else await reply(route, "Replacement answer", "new");
  });
  const block = await setup(page); const field = block.getByPlaceholder("Ask Albert…");
  await field.fill("First question"); await field.press("Enter");
  await expect.poll(() => count).toBe(1);
  await field.fill("Replacement question"); await field.press("Enter");
  await expect(block.locator(".albert")).toContainText(/Replacement\s*answer/);
  release();
  await expect(block.locator(".albert")).not.toContainText(/Obsolete\s*answer/);
  await expect.poll(() => page.evaluate(() => window.__albert!.state.events.filter(e => e.type === "hint_shown").length)).toBe(1);
});
test("R3.2-AC1: failing mock preserves ink and saved work, then retry succeeds", async ({ page }) => {
  let count = 0;
  await page.route("**/api/hint", async route => {
    if (++count === 1) await route.fulfill({ status: 503, body: "unavailable" });
    else await reply(route, "Try this next", "retry");
  });
  const block = await setup(page); await draw(page);
  const before = await page.evaluate(() => window.__albert!.state.strokes);
  const field = block.getByPlaceholder("Ask Albert…"); await field.fill("What changes?"); await field.press("Enter");
  await expect(page.getByText(/couldn't get a hint|could not|try again/i).first()).toBeVisible();
  expect(await page.evaluate(() => window.__albert!.state.strokes)).toEqual(before);
  await field.press("Enter"); await expect(block.locator(".albert")).toContainText(/Try\s*this\s*next/);
  await expect.poll(async () => { const r = await page.request.get("/api/session/latest?worksheetId=calc2-ws3"); return (await r.json()).events.filter((e: { type: string }) => e.type === "stroke_end").length; }).toBe(1);
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("annotated.pdf");
});

test("R3.2: replacement stops an active reveal without skipping the new pointer animation", async ({ page }) => {
  await page.clock.install();
  let count = 0;
  await page.route("**/api/hint", async route => {
    const request = route.request().postDataJSON() as HintRequest;
    const n = ++count;
    const rowId = request.rows[0]!.rowId;
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "started", hintId: `animate-${n}`, at: 0 },
      ...(n === 1 ? [] : [{ type: "mark", mark: { type: "circle", rowId, clusterIds: [`${rowId}/c1`] } }]),
      { type: "hint", kind: "question", segments: [{ type: "text", text: n === 1 ? "An obsolete reply that is deliberately long enough to still be revealing when the next question is sent." : "Replacement" }] },
      { type: "done", hintId: `animate-${n}`, ms: { firstEvent: 1, total: 2 } },
    ].map(e => JSON.stringify(e) + "\n").join("") });
  });
  const block = await setup(page); await draw(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const field = block.getByPlaceholder("Ask Albert…");
  await field.fill("First"); await field.press("Enter");
  await expect(block.locator('[data-albert-writing]')).toHaveCount(1);
  const oldId = await block.locator('[data-albert-hint]').getAttribute("data-albert-hint");
  await field.fill("Second"); await field.press("Enter");
  await expect.poll(() => count).toBe(2);
  await page.clock.runFor(64);
  await expect(block.locator('[data-albert-pointer]')).toHaveCount(1);
  await expect(block.locator('[data-albert-pointer]')).not.toHaveAttribute("data-pointer-arrived", "true");
  await expect(block.locator(`[data-albert-hint="${oldId}"]`)).toHaveCount(0);
  await page.clock.runFor(5000);
  await expect.poll(() => page.evaluate(() => window.__albert!.state.events.filter(e => e.type === "hint_shown").length)).toBe(1);
  await expect(block.locator('.albert')).toContainText("Replacement");
  await expect(block.locator('.albert')).not.toContainText("obsolete");
});
