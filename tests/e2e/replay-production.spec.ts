import { expect, test } from "@playwright/test";

test("production disables recording toolbar, fixture access and inspection hook", async ({ page, request }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  await page.goto("/work/demo?dev=1&replay=sample&speed=instant");
  await expect(page.locator("svg[data-capture-ready=true]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Load recording")).toHaveCount(0);
  expect(await page.evaluate(() => "__albert" in window)).toBe(false);
  await expect(page.locator("path[data-stroke-id]")).toHaveCount(0);
  expect((await request.get("/api/dev/recording?name=sample")).status()).toBe(404);
  expect((await request.get("/api/dev/evidence?courseId=course1")).status()).toBe(404);
  expect((await request.post("/api/dev/evidence", { data: {} })).status()).toBe(404);
});
