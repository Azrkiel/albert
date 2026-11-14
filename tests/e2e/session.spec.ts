import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { SessionEvent } from "../../src/lib/contracts";

async function replay(page: Page, name = "sample") {
  await page.goto(`/work/demo?dev=1&replay=${name}&speed=instant`);
  await page.waitForFunction(() => window.__albert?.replayDone === true && window.__albert.sessionId !== undefined);
}
const sessionId = (page: Page) => page.evaluate(() => window.__albert!.sessionId!);
const storeEvents = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__albert!.state.events)) as SessionEvent[]);
async function stored(request: APIRequestContext, id: string): Promise<SessionEvent[]> {
  const response = await request.get(`/api/dev/session-events?id=${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { events: SessionEvent[] }).events;
}

test("P2.8-AC1: replayed events reach the store in order, without a manual flush", async ({ page, request }) => {
  await replay(page);
  const id = await sessionId(page);
  const events = await storeEvents(page);
  expect(events.length).toBeGreaterThanOrEqual(3);
  // The page's own 3 s timer does the flush; poll until it has.
  await expect.poll(async () => (await stored(request, id)).length, { timeout: 10_000 }).toBe(events.length);
  expect(await stored(request, id)).toEqual(events);
});

test("a failed post keeps its batch and the next post delivers everything in order", async ({ page, request }) => {
  let failed = 0;
  await page.route("**/api/session/*/events", async (route) => {
    if (failed++ === 0) await route.abort("failed"); else await route.continue();
  });
  await replay(page);
  const id = await sessionId(page);
  const events = await storeEvents(page);
  await expect.poll(() => failed, { timeout: 10_000 }).toBeGreaterThan(1);
  await expect.poll(async () => (await stored(request, id)).length, { timeout: 10_000 }).toBe(events.length);
  expect(await stored(request, id)).toEqual(events);
});

test("End session flushes first and marks the session ended", async ({ page, request }) => {
  await replay(page);
  const id = await sessionId(page);
  const events = await storeEvents(page);
  const ended = page.waitForResponse((r) => r.url().endsWith(`/api/session/${id}/end`));
  await page.getByRole("button", { name: "End session" }).click();
  expect((await ended).status()).toBe(200);
  await expect(page.getByText(/Session ended/)).toBeVisible();
  await expect(page.getByRole("button", { name: "End session" })).toBeDisabled();
  expect(await stored(request, id)).toEqual(events); // ending flushed first
  expect((await request.post(`/api/session/${id}/end`)).status()).toBe(200);
  expect((await request.post("/api/session/nope/end")).status()).toBe(404);
});

test("a second replay is its own session; the first keeps its events", async ({ page, request }) => {
  await replay(page);
  const first = await sessionId(page);
  const events = await storeEvents(page);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction((old) => window.__albert?.replayDone === true && window.__albert.sessionId !== undefined && window.__albert.sessionId !== old, first);
  const second = await sessionId(page);
  expect(second).not.toBe(first);
  await expect.poll(async () => (await stored(request, second)).length, { timeout: 10_000 }).toBe(events.length);
  expect(await stored(request, second)).toEqual(events);
  expect(await stored(request, first)).toEqual(events);
});

test("hint requests carry the store's session id once it is known", async ({ page }) => {
  await replay(page);
  const id = await sessionId(page);
  const request = await page.evaluate(() => window.__albert!.buildHintRequest!("demo/p1/r1", 1, "manual"));
  expect(request.sessionId).toBe(id);
});

test("production: the dev session read-back route is gone", async ({ request }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  expect((await request.get("/api/dev/session-events?id=x")).status()).toBe(404);
});

async function draw(page: Page, y: number) {
  const point = (x: number) => page.getByRole("img", { name: "Worksheet work surface" }).first().evaluate((svg, p) => {
    const client = new DOMPoint(p.x, p.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: client.x, y: client.y };
  }, { x, y });
  const from = await point(100);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await point(300);
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("live ink is stored, and ink after End session starts a new session", async ({ page, request }) => {
  await page.goto("/work/demo");
  await expect(page.locator("svg[data-capture-ready=true]").first()).toBeVisible();
  await page.waitForFunction(() => window.__albert?.sessionId !== undefined);
  const first = await sessionId(page);
  await draw(page, 60);
  await expect.poll(async () => (await stored(request, first)).map((e) => e.type), { timeout: 10_000 }).toContain("stroke_end");
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText(/Session ended/)).toBeVisible();
  await draw(page, 90);
  await expect(page.getByText(/Session ended/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End session" })).toBeEnabled();
  await page.waitForFunction((old) => window.__albert?.sessionId !== undefined && window.__albert.sessionId !== old, first);
  const second = await sessionId(page);
  await expect.poll(async () => (await stored(request, second)).map((e) => e.type), { timeout: 10_000 }).toContain("stroke_end");
  expect((await stored(request, first)).filter((e) => e.type === "stroke_end")).toHaveLength(1);
});
