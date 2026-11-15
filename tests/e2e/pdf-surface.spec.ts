import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { readPdfText } from "../../src/lib/lms/pdf";

test.setTimeout(90_000);

async function draw(page: Page, number: number, x: number, y: number) {
  const surface = page.locator(`svg[data-page="${number}"][data-capture-ready=true]`);
  await surface.scrollIntoViewIfNeeded();
  await surface.evaluate((svg, p) => {
    const m = (svg as SVGSVGElement).getScreenCTM()!;
    window.scrollBy(0, m.b * p.x + m.d * p.y + m.f - innerHeight / 2);
  }, { x, y });
  const point = await surface.evaluate((svg, p) => {
    const m = (svg as SVGSVGElement).getScreenCTM()!;
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f,
      endX: m.a * (p.x + 20) + m.c * (p.y + 20) + m.e, endY: m.b * (p.x + 20) + m.d * (p.y + 20) + m.f };
  }, { x, y });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.endX, point.endY, { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ request }) => {
  const latest = await request.get("/api/session/latest?worksheetId=calc2-ws3&fileId=calc2-worksheet-3");
  const body = await latest.json();
  if (body.session) await request.post(`/api/session/${body.session.id}/end`);
});

test("production: PDF writing autosaves, reloads and downloads through the visible controls", async ({ page }) => {
  await page.goto("/work/calc2-ws3?surface=pdf");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  const stored = page.waitForResponse(response => response.url().includes("/events") && response.request().method() === "POST" && response.ok()
    && response.request().postDataJSON().events.some((event: { type: string; stroke?: { page?: number } }) => event.type === "stroke_end" && event.stroke?.page === 2));
  await draw(page, 1, 1000, 420); await draw(page, 2, 1000, 260);
  await stored;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  const pdf = await PDFDocument.load(await readFile((await (await download).path())!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages().every(p => p.node.Contents() !== undefined)).toBe(true);
});

test("writes on both PDF pages, edits by page, restores and downloads the original with ink", async ({ page }) => {
  await page.goto("/work/calc2-ws3?source=worksheet&surface=pdf");
  await expect(page.locator("[data-pdf-page]")).toHaveCount(2);
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await draw(page, 1, 1000, 420);
  await draw(page, 2, 1000, 260);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(2);
  const strokes = await page.evaluate(() => window.__albert!.state.strokes);
  expect(strokes.map(s => [s.page, s.problemId])).toEqual([[1, "calc2-ws3/p1"], [2, "calc2-ws3/p4"]]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("path[data-stroke-id][data-page='2']")).toHaveCount(0);
  await expect(page.locator("path[data-stroke-id][data-page='1']")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(2);
  await page.evaluate(() => window.__albert!.flushSession!());
  const session = await page.evaluate(() => window.__albert!.sessionId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(2);
  expect(await page.evaluate(() => window.__albert!.state.strokes)).toEqual(strokes);
  expect(await page.evaluate(() => window.__albert!.sessionId)).toBe(session);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/annotated\.pdf$/);
  const pdf = await PDFDocument.load(await readFile((await saved.path())!));
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages().map(p => p.getSize())).toEqual([{ width: 612, height: 792 }, { width: 612, height: 792 }]);
});

test("draws hints around current PDF ink, keeps notes below print and exports those notes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/hint", async route => {
    const req = route.request().postDataJSON();
    const rowId = req.rowId as string;
    const events = [
      { type: "started", hintId: "pdf-test", at: 0 },
      { type: "mark", mark: { type: "circle", rowId, clusterIds: [`${rowId}/c1`] } },
      { type: "hint", kind: "question", segments: [{ type: "text", text: "Check the differential" }, { type: "math", latex: "dx" }] },
      { type: "done", hintId: "pdf-test", ms: { firstEvent: 1, total: 2 } },
    ];
    await route.fulfill({ contentType: "application/x-ndjson", body: events.map(e => JSON.stringify(e)).join("\n") + "\n" });
  });
  await page.goto("/work/calc2-ws3?surface=pdf");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await draw(page, 1, 1000, 420);
  await page.getByRole("button", { name: "I'm stuck", exact: true }).first().click();
  await expect(page.locator("[data-albert-chip]")).toBeVisible({ timeout: 20_000 });
  const note = await page.locator("[data-albert-writing]").evaluate(el => {
    const box = (el as SVGGElement).getBBox(); return { y: box.y, height: box.height };
  });
  expect(note.y).toBeGreaterThan(1552);
  const circle = await page.locator("[data-mark-kind=circle]").evaluate(el => {
    const box = (el as SVGGElement).getBBox(); return { width: box.width, height: box.height };
  });
  expect(circle.width).toBeLessThan(100); expect(circle.height).toBeLessThan(100);
  await expect(page.locator("[data-mark-kind=arrow]")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PDF", exact: true }).click();
  const bytes = new Uint8Array(await readFile((await (await download).path())!));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  const text = await readPdfText(bytes);
  expect(text[2]!.items.map(item => item.str).join(" ")).toContain("Check the differential");
  await page.screenshot({ path: ".p57-r21-qa/pdf-page-notes.png", fullPage: true });
});

test("the reported blank-row scenario uses a neutral recorded reply without a giant circle", async ({ page }) => {
  await page.goto("/work/calc2-ws3?surface=ruled&dev=1");
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await expect(surface).toBeVisible();
  // Use a real pointer to satisfy browser pointer capture.
  const box = await surface.boundingBox();
  await page.mouse.move(box!.x + 80, box!.y + 110); await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 120); await page.mouse.up();
  await page.getByRole("button", { name: "Request mock hint", exact: true }).click();
  await expect(page.locator("[data-albert-writing]")).toContainText(/Which\s*part\s*of\s*this\s*step/, { timeout: 20_000 });
  await expect(page.locator("[data-mark-kind=circle]")).toHaveCount(0);
  await expect(page.locator("[data-recorded-preview]")).toBeVisible();
  await expect(page.getByText("You replaced x.", { exact: false })).toHaveCount(0);
});

test("keeps logical ink aligned through resizing and zoom, erases across problem selection, and snapshots print", async ({ page }) => {
  await page.goto("/work/calc2-ws3?surface=pdf");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await draw(page, 1, 1000, 420);
  await page.setViewportSize({ width: 800, height: 900 });
  await draw(page, 1, 1000, 420);
  await page.evaluate(() => { document.body.style.zoom = "1.25"; });
  await draw(page, 1, 1000, 420);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(3);
  const boxes = await page.evaluate(() => window.__albert!.state.strokes.map(s => s.bbox));
  for (const box of boxes) {
    expect(box.x).toBeCloseTo(1000, 0); expect(box.y).toBeCloseTo(420, 0);
    expect(box.w).toBeCloseTo(20, 0); expect(box.h).toBeCloseTo(20, 0);
  }
  const pixels = await page.evaluate(async () => {
    const state = window.__albert!.state;
    const snapshot = await window.__albert!.renderSnapshot!({ upToRowId: state.strokes[0]!.rowId!, marked: false });
    const image = new Image(); image.src = `data:image/png;base64,${snapshot.png}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = snapshot.width; canvas.height = snapshot.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let grey = 0, dark = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i]! > 140 && rgba[i]! < 230) grey++;
      if (rgba[i]! < 80) dark++;
    }
    return { grey, dark };
  });
  expect(pixels.grey).toBeGreaterThan(100); expect(pixels.dark).toBeGreaterThan(10);
  await page.getByLabel("Problem on page 1").selectOption("calc2-ws3/p2");
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await draw(page, 1, 1000, 420);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(3);
});

test("failed restore stays blocked until retry, while failed autosave keeps ink and retries the buffered events", async ({ page }) => {
  let lookupWorks = false, saveWorks = false;
  await page.route("**/api/session/latest?**", route => lookupWorks ? route.continue() : route.fulfill({ status: 503, json: { error: "offline" } }));
  await page.route("**/api/session/*/events", route => saveWorks ? route.continue() : route.fulfill({ status: 503, json: { error: "offline" } }));
  await page.goto("/work/calc2-ws3?surface=pdf");
  await expect(page.getByRole("alert")).toContainText("Could not load or save");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(0);
  await page.clock.install();
  await page.clock.fastForward(4000);
  await expect(page.getByRole("alert")).toBeVisible();
  lookupWorks = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await draw(page, 1, 1000, 420);
  expect(await page.evaluate(() => window.__albert!.flushSession!())).toBe(false);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(1);
  saveWorks = true;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(1);
});
