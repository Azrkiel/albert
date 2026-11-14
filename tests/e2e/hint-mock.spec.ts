import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const missingDx = 'section[data-problem-id="calc2-ws3/p1"]';

test("P3.1-AC4: replay missing dx, tap the hint mark, see Albert's question", async ({ page }) => {
  test.fixme(!existsSync("fixtures/sessions/missing-dx.json"), "needs P2.6 hint mark and fixtures/sessions/missing-dx.json");
  await page.goto("/work/calc2-ws3?replay=missing-dx&speed=instant");
  await page.waitForFunction(() => window.__albert?.replayDone === true);
  const problem = page.locator(missingDx);
  await expect(problem.locator("path[data-stroke-id]").first()).toBeVisible();
  const mark = problem.getByRole("button", { name: "Need a hint?", exact: true });
  await expect(mark).toBeVisible({ timeout: 25000 });
  await mark.click();
  const column = problem.locator("[data-albert-column]");
  await expect(column).toContainText("What does dx become?");
  await expect(column).toHaveCSS("color", "rgb(200, 50, 30)");
});

test("dev hint button is opt-in and displays rung 1 in red in the correct column", async ({ page }) => {
  await page.goto("/work/calc2-ws3");
  await expect(page.getByRole("button", { name: "Request mock hint" })).toHaveCount(0);
  await page.goto("/work/calc2-ws3?dev=1");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  const button = page.getByRole("button", { name: "Request mock hint" });
  await expect(button).toBeVisible();
  const sent = page.waitForRequest((request) => request.url().endsWith("/api/hint") && request.method() === "POST");
  await button.click();
  expect((await sent).postDataJSON()).toMatchObject({ problemId: "calc2-ws3/p1", rowId: "calc2-ws3/p1/r3", rung: 1 });
  await expect(button).toBeDisabled();
  const column = page.locator(missingDx).locator("[data-albert-column]");
  await expect(column).toHaveText("You replaced x. What does dx become?");
  await expect(column).toHaveCSS("color", "rgb(200, 50, 30)");
  await expect(page.locator('section[data-problem-id="calc2-ws3/p2"] [data-albert-column]')).toBeEmpty();
  await expect(button).toBeEnabled();
});

for (const scenario of ["non-2xx", "invalid line", "truncated stream"] as const) {
  test(`client handles ${scenario} with an error state and remains usable`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.route("**/api/hint", (route) => route.fulfill({
      status: scenario === "non-2xx" ? 503 : 200,
      contentType: "application/x-ndjson",
      body: scenario === "invalid line" ? "bad JSON\n" : '{"type":"started","hintId":"partial","at":0}\n',
    }));
    await page.goto("/work/calc2-ws3?dev=1");
    // Wait for hydration: a click on server-rendered markup before React attaches is lost (Nov 14 CI flake).
    await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
    const button = page.getByRole("button", { name: "Request mock hint" });
    await button.click();
    const column = page.locator(missingDx).locator("[data-albert-column]");
    // P3.8: an invalid line shows the bad_model_output note; non-2xx and truncation show model_unavailable.
    await expect(column).toHaveText(scenario === "invalid line" ? "Albert couldn't read that. Try again?" : "Albert can't reach his notes right now. Try again.");
    await expect(button).toBeEnabled();
    await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
    expect(pageErrors).toEqual([]);
  });
}
