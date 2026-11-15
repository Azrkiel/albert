import { expect, test } from "@playwright/test";

for (const source of ["handwriting", "worksheet"] as const) {
  test(`${source} page shows its actual source and sends it through the live snapshot builder`, async ({ page }) => {
    await page.route("**/api/hint", route => route.fulfill({ contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", code: "model_unavailable", message: "Test" }) + "\n" }));
    await page.goto(`/work/calc2-ws3?source=${source}&layout=ruled`);
    await expect(page.locator("[data-problem-source]").filter({ hasText: source === "handwriting" ? "General calculus" : "Worksheet 3" })).toBeVisible();
    const statements = page.locator("[data-problem-statement]");
    if (source === "handwriting") {
      await expect(statements.first()).toHaveText("Write your problem, then work one step per row.");
      expect(await statements.allTextContents()).not.toEqual(expect.arrayContaining([expect.stringContaining("sqrt")]));
      await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
    } else {
      await expect(statements).toHaveCount(5);
      await expect(statements.first()).toHaveAttribute("data-latex", String.raw`$\int \frac{dx}{x^2\sqrt{16-x^2}}$`);
      await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
    }
    const sent = page.waitForRequest(request => request.url().endsWith("/api/hint"));
    await page.getByRole("button", { name: "I'm stuck", exact: true }).first().click();
    const input = (await sent).postDataJSON();
    expect(input).toMatchObject({ problemSource: source, problemId: "calc2-ws3/p1" });
    if (source === "handwriting") expect(input.image.clean).toBeTruthy();
  });
}

test("general calculus has its own blank workspace and no assigned problem", async ({ page }) => {
  await page.goto("/work/general-calculus");
  await expect(page.locator("[data-problem-source]").filter({ hasText: "General calculus" })).toBeVisible();
  await expect(page.locator("[data-problem-statement]").first()).toHaveText("Write your problem, then work one step per row.");
});


test("switching to general practice starts a fresh canvas and drops the worksheet hint", async ({ page }) => {
  await page.route("**/api/hint", route => route.fulfill({ contentType: "application/x-ndjson", body: [
    { type: "started", hintId: "worksheet-only", at: 0 },
    { type: "hint", kind: "question", segments: [{ type: "text", text: "What does the assigned problem ask?" }] },
    { type: "done", hintId: "worksheet-only", ms: { firstEvent: 1, total: 2 } },
  ].map(event => JSON.stringify(event) + "\n").join("") }));
  await page.goto("/work/calc2-ws3?surface=ruled");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(5);
  await page.getByRole("button", { name: "I'm stuck", exact: true }).first().click();
  await expect(page.locator("[data-albert-column]").first()).toHaveText("What does the assigned problem ask?");
  await page.getByRole("navigation", { name: "Problem source" }).getByRole("link", { name: "General calculus", exact: true }).click();
  await expect(page.locator('[data-problem-source="handwriting"]')).toBeVisible();
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  for (const column of await page.locator("[data-albert-column]").all()) await expect(column).toBeEmpty();
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0);
});
