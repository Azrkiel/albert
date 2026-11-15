import { expect, test } from "@playwright/test";
import { DEMO_PRIVATE_NOTE } from "../../src/lib/progress/demo-history";

const COURSE = "p74";

test.beforeAll(async ({ request }) => {
  const seeded = await request.post("/api/dev/progress", { data: { action: "seed", courseId: COURSE } });
  expect(seeded.ok()).toBeTruthy();
});

test("P7.4-AC2: the report renders a stuck point with its snapshot and what was wrong", async ({ page }, testInfo) => {
  await page.goto(`/report/${COURSE}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tutor report — Ada · Calculus II · this week");
  const withImage = page.getByTestId("stuck-point").filter({ has: page.locator("img") });
  await expect(withImage).toHaveCount(1);
  await expect(withImage.getByText("What was wrong")).toBeVisible();
  await expect(withImage.getByText("Albert asked: You replaced x. What does dx become?")).toBeVisible();
  await expect(withImage.locator("img")).toHaveJSProperty("complete", true);
  expect(await withImage.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  await expect(page.getByRole("heading", { name: "Suggested focus for your next session" })).toBeVisible();
  await expect(page.locator('[data-slot="peri"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("tutor-report.png"), fullPage: true });
});

test("P7.4-AC4: the report shows the private note; the work page never does", async ({ page, request }) => {
  await page.goto(`/report/${COURSE}`);
  await expect(page.getByTestId("tutor-report")).toContainText(DEMO_PRIVATE_NOTE);
  const api = await (await request.get(`/api/report/${COURSE}`)).text();
  expect(api).toContain(DEMO_PRIVATE_NOTE);

  await page.goto(`/work/${COURSE}-ws3`);
  await expect(page.locator("svg[data-capture-ready=true]").first()).toBeVisible();
  const rendered = await page.content();
  expect(rendered).not.toContain(DEMO_PRIVATE_NOTE);
  expect(rendered).not.toContain("privateNote");
  expect(await (await request.get(`/work/${COURSE}-ws3`)).text()).not.toContain(DEMO_PRIVATE_NOTE);
});

test("production: the progress test-setup route is gone", async ({ request }) => {
  test.skip(process.env.ALBERT_E2E_PRODUCTION !== "1", "Run with ALBERT_E2E_PRODUCTION=1 after pnpm build");
  expect((await request.post("/api/dev/progress", { data: { action: "seed", courseId: "x" } })).status()).toBe(404);
});
