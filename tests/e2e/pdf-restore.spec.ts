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
import type { SessionEvent } from "../../src/lib/contracts";

async function draw(page: Page, n: number, x: number, y: number) {
  const surface = page.locator(`svg[data-capture-ready=true][data-page="${n}"]`);
  await surface.evaluate((svg, y) => {
    const point = new DOMPoint(0, y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    window.scrollBy(0, point.y - window.innerHeight / 2);
  }, y);
  const points = await surface.evaluate((svg, { x, y }) => [new DOMPoint(x, y), new DOMPoint(x + 15, y + 25)].map(p => {
    const c = p.matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: c.x, y: c.y };
  }), { x, y });
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 });
  await page.mouse.up();
}

async function ready(page: Page) {
  await expect(page.locator("svg[data-capture-ready=true][data-page]")).toHaveCount(2);
  await page.waitForFunction(() => window.__albert?.sessionId !== undefined);
}

test("R2.3-AC1: reload restores both pages into the same session without reposting; undo/redo survive", async ({ page }) => {
  await page.goto("/work/calc2-ws3?dev=1");
  await ready(page);
  await draw(page, 1, 1100, 400);
  await draw(page, 2, 1100, 240);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const saved = await page.evaluate(async () => {
    await window.__albert!.flushSession!();
    return { state: window.__albert!.state, sessionId: window.__albert!.sessionId };
  });
  expect(saved.state.strokes).toHaveLength(2);
  expect(saved.state.strokes.map(s => s.page)).toEqual([1, 2]);
  expect(saved.state.redoStack).toHaveLength(1);
  const posts: { url: string; events?: SessionEvent[] }[] = [];
  page.on("request", request => {
    if (request.method() !== "POST" || !request.url().includes("/api/session")) return;
    posts.push({ url: request.url(), events: request.postDataJSON()?.events });
  });
  await page.reload();
  await ready(page);
  const restored = await page.evaluate(() => ({ state: window.__albert!.state, sessionId: window.__albert!.sessionId }));
  expect(restored.sessionId).toBe(saved.sessionId);
  expect(restored.state.strokes).toEqual(saved.state.strokes);
  expect(restored.state.undoStack).toEqual(saved.state.undoStack);
  expect(restored.state.redoStack).toEqual(saved.state.redoStack);
  await page.evaluate(() => window.__albert!.flushSession!());
  expect(posts).toEqual([]);
  await expect(page.locator('svg[data-page="1"] path[data-stroke-id]')).toHaveCount(1);
  await expect(page.locator('svg[data-page="2"] path[data-stroke-id]')).toHaveCount(0);
  // Select page 2, then redo its saved undo. The original id and points return unchanged.
  await page.locator('[data-pdf-page="2"]').getByRole("button", { name: "Problem 4", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('svg[data-page="2"] path[data-stroke-id]')).toHaveCount(1);
  const beforeNewInk = await page.evaluate(() => window.__albert!.state.strokes);
  expect(beforeNewInk[1]).toEqual({ ...saved.state.strokes[1], erasedAt: undefined });
  await draw(page, 2, 1150, 245);
  await page.evaluate(() => window.__albert!.flushSession!());
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.every(post => post.url.endsWith(`/api/session/${saved.sessionId}/events`))).toBe(true);
  const posted = posts.flatMap(post => post.events ?? []);
  expect(posted.map(e => e.type)).toEqual(["undo", "stroke_end"]);
  const newDraws = posted.filter(e => e.type === "stroke_end");
  expect(newDraws).toHaveLength(1);
  expect(saved.state.strokes.some(s => s.id === newDraws[0]!.stroke.id)).toBe(false);
  expect(newDraws[0]!.at).toBeGreaterThan(saved.state.durationMs);
});

test("R2.3: a delayed restore cannot overwrite a newly loaded legacy recording", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let seen!: () => void;
  const lookup = new Promise<void>(resolve => { seen = resolve; });
  await page.route("**/api/session/latest?worksheetId=calc2-ws3*", async route => {
    seen();
    await held;
    await route.fulfill({ json: { session: { id: "stale-session", worksheetId: "calc2-ws3", courseId: "calc2", studentId: "demo", startedAt: "2026-11-15T00:00:00Z", surface: "pdf", fileId: "calc2-worksheet-3" }, events: [{ type: "stroke_end", at: 20, stroke: {
        id: "stale-ink", problemId: "calc2-ws3/p1", rowId: null, tool: "pen", pointerType: "mouse",
        t0: 10, t1: 20, points: [{ x: 100, y: 300, t: 10, p: 0.5 }, { x: 130, y: 320, t: 20, p: 0.5 }],
        bbox: { x: 100, y: 300, w: 30, h: 20 },
      } }] } });
  });
  await page.goto("/work/calc2-ws3?dev=1&speed=instant");
  await lookup;
  await page.getByLabel("Load recording").setInputFiles("fixtures/sessions/missing-dx.json");
  await page.waitForFunction(() => window.__albert?.replayDone);
  const strokes = await page.evaluate(() => window.__albert!.state.strokes);
  const response = page.waitForResponse(response => response.url().includes("/api/session/latest?"));
  release();
  await (await response).finished();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(strokes.filter(s => s.tool === "pen" && s.erasedAt === undefined).length);
  expect(await page.evaluate(() => window.__albert!.state.strokes)).toEqual(strokes);
  expect(await page.evaluate(() => window.__albert!.sessionId)).not.toBe("stale-session");
});
