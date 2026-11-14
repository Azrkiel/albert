import { expect, test } from "@playwright/test";

const pages = [
  { route: "/", heading: "Connect your course" },
  { route: "/courses", heading: "Pick a course" },
  { route: "/course/demo-course", heading: "Plan, skills, worksheets" },
  { route: "/work/demo-worksheet", heading: "The page you write on" },
  { route: "/report/demo-course", heading: "Tutor report" },
];

for (const { route, heading } of pages) {
  test(`${route} renders its heading and shared shell`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.locator("main p")).not.toBeEmpty();
    await expect(page.getByRole("banner").getByRole("link", { name: "Albert", exact: true })).toBeVisible();
    await expect(page.getByText("Turns you into Einstein.", { exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Services not ready");
    expect(errors).toEqual([]);
  });
}

test("health returns exactly the five documented keys", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    db: false,
    llm: false,
    courseSource: null,
    provider: "bedrock",
    store: "memory",
  });
});

test("status dot reflects a healthy response", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    json: { db: true, llm: true, courseSource: null, provider: "bedrock", store: "memory" },
  }));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Services ready");
});

test("status dot handles an unavailable health route", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Service status unavailable");
});
