import { expect, test, type Locator, type Page } from "@playwright/test";

// P3.8-AC1: each error mock shows exactly its note, leaves no partial text or Albert ink,
// and the page stays usable. The mocks in fixtures/llm/error-*.json are reused by P4.4-AC3.
const missingDx = 'section[data-problem-id="calc2-ws3/p1"]';
const firstHint = "You replaced x. What does dx become?";
const albertRed = "rgb(200, 50, 30)";
const albertInk = "[data-ink-segment], [data-ink-math], [data-ink-text], [data-ink-revealing]";

const cases = [
  { fixtureId: "error-model_unavailable", note: "Albert can't reach his notes right now. Try again." },
  { fixtureId: "error-bad_model_output", note: "Albert couldn't read that. Try again?" },
  { fixtureId: "error-timeout", note: "That took too long. Try again?" },
  { fixtureId: "error-mid-stream", note: "That took too long. Try again?", partial: "Partial hint that must not stay visible?" },
] as const;

// Send the next hint request through the real route and mock loader with this fixture.
async function useFixtureOnce(page: Page, fixtureId: string) {
  let pending: string | undefined = fixtureId;
  await page.route("**/api/hint", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const postData = JSON.stringify(pending ? { ...body, fixtureId: pending } : body);
    pending = undefined;
    await route.continue({ postData });
  });
}

async function drawInFirstRow(page: Page, problem: Locator) {
  const surface = problem.locator("svg[data-capture-ready=true]");
  const row = await page.evaluate(() => window.__albert!.state.rows.find((r) => r.problemId === "calc2-ws3/p1")!.bbox);
  await surface.scrollIntoViewIfNeeded();
  const [from, to] = await surface.evaluate((svg, points) => points.map(([px, py]) => {
    const client = new DOMPoint(px, py).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: client.x, y: client.y };
  }), [[row.x + 80, row.y + row.h / 2], [row.x + 140, row.y + row.h / 2 + 10]]);
  await page.mouse.move(from!.x, from!.y);
  await page.mouse.down();
  await page.mouse.move(to!.x, to!.y, { steps: 6 });
  await page.mouse.up();
}

for (const { fixtureId, note, ...rest } of cases) {
  test(`P3.8-AC1: ${fixtureId} shows its note, no partial text, and the page stays usable`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await useFixtureOnce(page, fixtureId);
    await page.goto("/work/calc2-ws3?dev=1");
    // Wait for hydration: a click before React attaches is lost (Nov 14 CI flake).
    await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
    const problem = page.locator(missingDx);
    const column = problem.locator("[data-albert-column]");
    const button = page.getByRole("button", { name: "Request mock hint" });
    const sent = page.waitForRequest((request) => request.url().endsWith("/api/hint") && request.method() === "POST");
    await button.click();
    expect((await sent).postDataJSON()).toMatchObject({ fixtureId });

    if ("partial" in rest) await expect(column).toHaveText(rest.partial, { timeout: 15000 });
    await expect(column).toHaveText(note, { timeout: 15000 });
    await expect(column).toHaveCSS("color", albertRed);
    await expect(problem.locator(albertInk)).toHaveCount(0);
    await expect(page.locator('section[data-problem-id="calc2-ws3/p2"] [data-albert-column]')).toBeEmpty();

    // Still usable: drawing adds a stroke, and the next request succeeds.
    const strokes = problem.locator("path[data-stroke-id]");
    const before = await strokes.count();
    await drawInFirstRow(page, problem);
    await expect(strokes).toHaveCount(before + 1);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(column).toHaveText(firstHint, { timeout: 15000 });
    expect(pageErrors).toEqual([]);
  });
}
