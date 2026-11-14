import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { PAGE } from "../../src/lib/contracts";

// All input below is synthetic automation through the real UI, not human handwriting.
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number, problem = 0) {
  const surface = page.locator("svg[data-capture-ready=true]").nth(problem);
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
const row2 = PAGE.statementMinHeight + PAGE.rowHeight + 30; // inside row 2 at any row height
const paths = (page: Page) => page.locator("path[data-stroke-id]");
const state = (page: Page) => page.evaluate(() => window.__albert!.state);

test.beforeEach(async ({ page }) => {
  await page.goto("/work/demo?dev=1");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
});

test("draw, erase, undo, redo and accessible Clear row survive export/load exactly", async ({ page }) => {
  await drag(page, 100, 126, 220, 126);
  await drag(page, 280, 126, 380, 126);
  await drag(page, 100, row2, 220, row2);
  await drag(page, 100, 126, 220, 126, 1);
  const original = await state(page);
  await expect(paths(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await drag(page, 150, 100, 150, 150);
  await expect(paths(page)).toHaveCount(3);
  const erased = await state(page);
  expect(erased.strokes).toHaveLength(4);
  expect(erased.strokes[0]!.erasedAt).toBeDefined();
  expect(erased.events.at(-1)).toMatchObject({ type: "erase", strokeIds: [original.strokes[0]!.id], rowId: "demo/p1/r1" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(paths(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(paths(page)).toHaveCount(3);
  const clear = page.getByRole("button", { name: "Clear row 1 of problem 1", exact: true });
  await clear.focus();
  await page.keyboard.press("Enter");
  await expect(paths(page)).toHaveCount(2);
  const before = await state(page);
  expect(before.events.at(-1)).toMatchObject({ type: "erase", strokeIds: [original.strokes[1]!.id], rowId: "demo/p1/r1" });
  expect(before.strokes.slice(2)).toEqual(original.strokes.slice(2));
  const visible = await paths(page).evaluateAll((els) => els.map((el) => ({ id: el.getAttribute("data-stroke-id"), d: el.getAttribute("d") })));
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const file = (await (await downloading).path())!;
  const exported = JSON.parse(await readFile(file, "utf8"));
  expect(exported.events).toEqual(before.events);
  await page.getByLabel("Playback speed").selectOption("instant");
  await page.getByLabel("Load recording").setInputFiles(file);
  await page.waitForFunction(() => window.__albert?.replayDone);
  expect(await state(page)).toEqual({ ...before, durationMs: exported.durationMs });
  expect(await paths(page).evaluateAll((els) => els.map((el) => ({ id: el.getAttribute("data-stroke-id"), d: el.getAttribute("d") })))).toEqual(visible);
  // Undo/redo remain usable after loading, with the original identities.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(paths(page)).toHaveCount(3);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(paths(page)).toHaveCount(2);
  await page.screenshot({ path: test.info().outputPath("erase-result.png"), fullPage: true });
});

test("Ctrl/Cmd+Z and shifted redo retain IDs; shortcuts leave text inputs alone", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await drag(page, 100, 126, 200, 126);
  const stroke = (await state(page)).strokes[0]!;
  for (const modifier of ["Control", "Meta"]) {
    await page.keyboard.press(`${modifier}+z`);
    await expect(paths(page)).toHaveCount(0);
    expect((await state(page)).events.at(-1)).toEqual({ type: "undo", at: expect.any(Number), strokeIds: [stroke.id], rowId: stroke.rowId });
    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect(paths(page)).toHaveCount(1);
    expect((await state(page)).strokes[0]).toEqual(stroke);
  }
  await page.evaluate(() => {
    const input = document.createElement("input"); input.id = "shortcut-text"; document.body.append(input);
  });
  await page.locator("#shortcut-text").fill("notes");
  const count = (await state(page)).events.length;
  await page.keyboard.press("Control+z");
  expect((await state(page)).events).toHaveLength(count);
  await expect(paths(page)).toHaveCount(1);
});

test("stylus eraser buttons bit 32 erases without drawing and returns to pen", async ({ page }) => {
  await drag(page, 100, 126, 220, 126);
  const surface = page.locator("svg[data-capture-ready=true]").first();
  await surface.evaluate((svg) => {
    // Native capture needs a trusted active pointer. Stub only capture for this synthetic
    // pen; exercise the real pointer listeners, tool selection, reducer and rendering.
    svg.setPointerCapture = () => {};
    const point = new DOMPoint(150, 126).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    for (const type of ["pointerdown", "pointermove", "pointerup"]) svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 17, pointerType: "pen", button: 5,
      buttons: type === "pointerup" ? 0 : 32, pressure: 0.5, clientX: point.x, clientY: point.y,
    }));
  });
  await expect(paths(page)).toHaveCount(0);
  expect((await state(page)).strokes).toHaveLength(1);
  expect((await state(page)).events.at(-1)?.type).toBe("erase");
  await drag(page, 300, 126, 420, 126);
  await expect(paths(page)).toHaveCount(1);
  expect((await state(page)).strokes.at(-1)?.tool).toBe("pen");
});
