import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// All tests share the offline memory server; close the preceding test's session for isolation.
test.beforeEach(async ({ request }) => {
  for (let n = 0; n < 200; n++) {
    const latest = await request.get("/api/session/latest?worksheetId=calc2-ws3");
    if (latest.status() === 404) return;
    expect(latest.ok()).toBe(true);
    const { session } = await latest.json();
    expect((await request.post(`/api/session/${encodeURIComponent(session.id)}/end`)).ok()).toBe(true);
  }
  throw new Error("Too many open test sessions");

});

/** Synthetic geometry through real pointer capture; never presented as a human recording. */
async function draw(page: Page, n: number, x: number, y: number) {
  const surface = page.locator(`svg[data-capture-ready=true][data-page="${n}"]`);
  await surface.evaluate((svg, y) => {
    const p = new DOMPoint(0, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    window.scrollBy(0, p.y - window.innerHeight / 2);
  }, y);
  const points = await surface.evaluate((svg, { x, y }) => [new DOMPoint(x, y), new DOMPoint(x + 12, y + 24)].map(p => {
    const c = p.matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    const viewport = window.visualViewport!;
    return { x: (c.x - viewport.offsetLeft) * viewport.scale, y: (c.y - viewport.offsetTop) * viewport.scale };
  }), { x, y });
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 });
  await page.mouse.up();
}
async function open(page: Page) {
  // Await the actual metadata response: the first dev request compiles the PDF route.
  const metadata = page.waitForResponse(r => r.url().endsWith("/api/files/calc2-worksheet-3/pages"));
  await page.goto("/work/calc2-ws3?dev=1");
  expect((await metadata).ok()).toBe(true);
  await expect(page.locator("svg[data-capture-ready=true][data-page]")).toHaveCount(2);
  await expect(page.locator("[data-pdf-background]")).toHaveCount(2);
  return (await (await page.request.get("/api/worksheet/calc2-ws3")).json()).problems as Array<{ id: string; region: { page: number; bbox: { y: number; h: number } } }>;
}

test("R2.2-AC1: page/problem ownership, full right edge, page-scoped erase, undo and redo", async ({ page }) => {
  const problems = await open(page);
  const y1 = problems[0]!.region.bbox.y + 60;
  const y2 = problems[3]!.region.bbox.y + 60;
  await draw(page, 1, 1180, y1);
  await draw(page, 2, 1180, y2);
  await expect.poll(() => page.evaluate(() => window.__albert!.state.strokes.length)).toBe(2);
  const original = await page.evaluate(() => window.__albert!.state.strokes);
  expect(original.map(s => [s.page, s.problemId])).toEqual([[1, "calc2-ws3/p1"], [2, "calc2-ws3/p4"]]);
  await expect(page.locator('svg[data-page="1"] path[data-stroke-id]')).toHaveCount(1);
  await expect(page.locator('svg[data-page="2"] path[data-stroke-id]')).toHaveCount(1);
  // The picker changes fallback identity; erasing still finds every problem's ink on this page.
  await page.locator('[data-pdf-page="1"]').getByRole("button", { name: "Problem 5", exact: true }).click();
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await draw(page, 1, 1180, y1);
  await expect(page.locator('svg[data-page="1"] path[data-stroke-id]')).toHaveCount(0);
  expect((await page.evaluate(() => window.__albert!.state.strokes))[1]).toEqual(original[1]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('svg[data-page="1"] path[data-stroke-id]')).toHaveCount(1);
  // Undo page 1's draw while page 2's more recent draw stays intact.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('svg[data-page="1"] path[data-stroke-id]')).toHaveCount(0);
  await expect(page.locator('svg[data-page="2"] path[data-stroke-id]')).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await page.evaluate(() => window.__albert!.state.strokes))[0]).toEqual(original[0]);
  // An unlabelled area uses the active picker, even for a problem printed on the other page.
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await draw(page, 1, 100, 10);
  expect((await page.evaluate(() => window.__albert!.state.strokes)).at(-1)).toMatchObject({ page: 1, problemId: "calc2-ws3/p5" });
});

test("R2.2-AC1: stored geometry is stable at two viewport widths, CSS zoom and browser viewport zoom", async ({ page }) => {
  await open(page);
  const geometry: unknown[] = [];
  for (const { width, zoom } of [{ width: 1440, zoom: 1 }, { width: 900, zoom: 1 }, { width: 1440, zoom: 1.25 }]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
    await draw(page, 1, 1100, 340);
    const s = await page.evaluate(() => window.__albert!.state.strokes.at(-1)!);
    geometry.push(s.points.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]));
  }
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.25 });
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1.25);
  await draw(page, 1, 1100, 340);
  geometry.push(await page.evaluate(() => window.__albert!.state.strokes.at(-1)!.points.map(p => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100])));
  await cdp.detach();
  expect(geometry[3]).toEqual(geometry[0]);
  expect(geometry[1]).toEqual(geometry[0]);
  expect(geometry[2]).toEqual(geometry[0]);
});

test("R2.2-AC2: the decoded hint snapshot includes light grey printed page pixels under black ink", async ({ page }) => {
  const problems = await open(page);
  await draw(page, 2, 1100, problems[3]!.region.bbox.y + 60);
  const pixels = await page.evaluate(async () => {
    const state = window.__albert!.state;
    const rowId = state.strokes.at(-1)!.rowId!;
    const snapshot = await window.__albert!.renderSnapshot!({ upToRowId: rowId, marked: false });
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${snapshot.png}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let grey = 0, ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! >= 200 && data[i]! <= 240 && Math.abs(data[i]! - data[i + 1]!) <= 1 && Math.abs(data[i]! - data[i + 2]!) <= 1) grey++;
      if (data[i]! < 70 && data[i + 1]! < 70 && data[i + 2]! < 70) ink++;
    }
    image.close();
    return { grey, ink, rows: snapshot.rows.map(r => r.rowId) };
  });
  expect(pixels.grey).toBeGreaterThan(30);
  expect(pixels.ink).toBeGreaterThan(10);
  expect(pixels.rows).toEqual(["calc2-ws3/p4/page2/r1"]);
});

test("R2.2: helper targets the real earlier row and writes under the work on page 2", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/hint", route => {
    const request = route.request().postDataJSON();
    const rowId = request.rows[0].rowId;
    return route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "started", hintId: "pdf-hint", at: 0 },
      { type: "mark", mark: { type: "circle", rowId, clusterIds: [`${rowId}/c1`] } },
      { type: "hint", kind: "question", segments: [{ type: "text", text: "What changes in your first step?" }] },
      { type: "done", hintId: "pdf-hint", ms: { firstEvent: 1, total: 2 } },
    ].map(e => JSON.stringify(e) + "\n").join("") });
  });
  const problems = await open(page);
  const y = problems[3]!.region.bbox.y + 60;
  await draw(page, 2, 600, y);
  await draw(page, 2, 600, y + 70);
  const block = page.locator('[data-pdf-page="2"]');
  await block.getByRole("button", { name: "I'm stuck", exact: true }).click();
  const writing = block.locator("[data-albert-writing]");
  await expect(writing).toContainText("Whatchangesinyourfirststep?");
  const geometry = await block.locator('svg[data-page="2"]').evaluate(svg => {
    const circle = svg.querySelector<SVGGraphicsElement>('[data-mark-kind="circle"]')!;
    const writing = svg.querySelector<SVGGraphicsElement>('[data-albert-writing]')!;
    const bg = svg.querySelector<SVGImageElement>("image")!;
    return { target: circle.getAttribute("data-target-row"), circle: ({ x: circle.getBBox().x, y: circle.getBBox().y }), writing: ({ x: writing.getBBox().x, y: writing.getBBox().y }), pageHeight: bg.height.baseVal.value };
  });
  expect(geometry.target).toBe("calc2-ws3/p4/page2/r1");
  expect(geometry.circle.y).toBeLessThan(y);
  // The note sits on the page right under the student's work, not in the band below the page.
  expect(geometry.writing.y).toBeGreaterThan(y + 70);
  expect(geometry.writing.y).toBeLessThan(geometry.pageHeight);
  await expect(page.locator('svg[data-page="1"] [data-albert-writing]')).toHaveCount(0);
  // Student ink stays usable on the printed page after the reply.
  await draw(page, 2, 600, y + 10);
  expect((await page.evaluate(() => window.__albert!.state.strokes)).filter(s => s.page === 2)).toHaveLength(3);
});

test("R2.2: a PDF problem deep link selects and highlights its page", async ({ page }) => {
  await page.goto("/work/calc2-ws3?problem=4");
  const block = page.locator('[data-pdf-page="2"]');
  await expect(block).toHaveAttribute("data-highlighted", "");
  await expect(block.getByRole("button", { name: "Problem 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(block).toBeInViewport();
});


test("R2.2: PDF hint recordings wait for asynchronously mounted page layers", async ({ page }) => {
  const recording = JSON.parse(readFileSync("fixtures/sessions/pdf-synthetic.json", "utf8").replaceAll("pdf/p1", "calc2-ws3/p1"));
  recording.fileId = "calc2-worksheet-3";
  const first = recording.events[0].stroke;
  const second = { ...first, id: "pdf-s2", page: 2, rowId: "calc2-ws3/p1/page2/r1", t0: 20, t1: 30,
    points: first.points.map((p: { t: number }) => ({ ...p, t: p.t + 20 })) };
  recording.rows.push({ ...recording.rows[0], page: 2, id: second.rowId });
  const marks = [
    { id: "pdf-replay/circle", hintId: "pdf-replay", problemId: second.problemId, drawnAt: 40, bbox: second.bbox,
      spec: { type: "circle", rowId: second.rowId, clusterIds: [`${second.rowId}/c1`] } },
    { id: "pdf-replay/writing", hintId: "pdf-replay", problemId: second.problemId, drawnAt: 40, bbox: { x: 16, y: 1580, w: 400, h: 40 },
      spec: { type: "writing", rowId: second.rowId, segments: [{ type: "text", text: "A saved PDF hint" }] } },
  ];
  recording.events.push({ type: "stroke_end", at: 30, stroke: second },
    { type: "hint_requested", at: 35, hintId: "pdf-replay", rowId: second.rowId, rung: 1 },
    { type: "hint_shown", at: 40, hintId: "pdf-replay", marks });
  recording.durationMs = 50;
  await page.route("**/api/dev/recording?name=synthetic-pdf", route => route.fulfill({ json: recording }));
  await page.route("**/api/files/calc2-worksheet-3/pages", async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 300)); // Deliberately make recording replay beat page loading.
    await route.fulfill({ response });
  });
  let hintRequests = 0;
  page.on("request", r => { if (r.url().endsWith("/api/hint")) hintRequests++; });
  await page.goto("/work/calc2-ws3?replay=synthetic-pdf&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone);
  const page2 = page.locator('[data-pdf-page="2"]');
  await expect(page2.locator('[data-mark-kind="circle"]')).toHaveCount(1);
  await expect(page2.locator("[data-albert-writing]")).toContainText("AsavedPDFhint");
  const y = await page2.locator("[data-albert-writing]").evaluate(el => (el as SVGGraphicsElement).getBBox().y);
  expect(y).toBeLessThan(1552); // on the page, under the work
  await expect(page.locator('[data-pdf-page="1"] [data-albert-writing]')).toHaveCount(0);
  expect(hintRequests).toBe(0);
});


test("R2.2: a shared problem's More help control belongs only to its hint page", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/hint", route => route.fulfill({ contentType: "application/x-ndjson", body: [
    { type: "started", hintId: "shared-problem", at: 0 },
    { type: "hint", kind: "question", segments: [{ type: "text", text: "Which step changes?" }] },
    { type: "done", hintId: "shared-problem", ms: { firstEvent: 1, total: 2 } },
  ].map(e => JSON.stringify(e) + "\n").join("") }));
  const problems = await open(page);
  await draw(page, 1, 100, problems[0]!.region.bbox.y + 60);
  const second = page.locator('[data-pdf-page="2"]');
  await second.getByRole("button", { name: "Problem 1", exact: true }).click();
  await draw(page, 2, 100, 10); // Unlabelled whitespace uses the selected problem.
  await second.getByRole("button", { name: "I'm stuck", exact: true }).click();
  await expect(second.locator("[data-albert-chip]")).toHaveCount(1);
  await expect(page.locator('[data-pdf-page="1"] [data-albert-chip]')).toHaveCount(0);
});
