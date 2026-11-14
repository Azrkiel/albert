import { readFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { CourseManifest } from "../../src/lib/contracts";

const recorded = JSON.parse(readFileSync("fixtures/github/manifest.json", "utf8")) as CourseManifest;
const live = JSON.parse(readFileSync("fixtures/github/live-manifest.json", "utf8")) as CourseManifest;
const { sha } = JSON.parse(readFileSync("fixtures/github/commit.json", "utf8")) as { sha: string };
const { sha: liveSha } = JSON.parse(readFileSync("fixtures/github/files/live-commit.json", "utf8")) as { sha: string };
const sentinel = "p55-server-only-token-sentinel";
const raw = "RAW_UPSTREAM_TEXT https://user:password@example.invalid/secret";
const errors = [
  { code: "not_found", status: 404, message: "The course source or cached file was not found." },
  { code: "forbidden", status: 403, message: "GitHub refused access to this course source." },
  { code: "rate_limited", status: 429, message: "GitHub's request limit was reached. Try again later." },
  { code: "unavailable", status: 503, message: "The course source is unavailable. Try again later." },
  { code: "bad_reply", status: 502, message: "The course source contains an invalid manifest or PDF." },
];
const course = (manifest = recorded, ingested = false) => ({
  id: manifest === live
    ? `github:Azrkiel/albert-files:manifest.json~${manifest.course.id}:${liveSha}:2026-11-14`
    : `github:Azrkiel/albert:seed%2Fcalc2%2Fmanifest.json~${manifest.course.id}:${sha}:2026-11-14`,
  title: manifest.course.title, shortName: manifest.course.shortName, ingested,
});

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  // Every connect request is intercepted, including in tests that do not click it.
  await page.route("**/api/source/connect", route => route.fulfill({ status: 503, json: errors[3] }));
  await page.route("**/api/source/courses", route => route.fulfill({ json: [] }));
  await page.route("https://api.github.com/**", route => route.abort());
});

for (const error of errors) {
  test(`P5.5-AC1: ${error.code} stays on import with its fixed message and permits retry`, async ({ page }, info) => {
    let attempts = 0;
    await page.route("**/api/source/connect", route => {
      expect(route.request().method()).toBe("POST");
      attempts++;
      return route.fulfill({ status: error.status, json: { code: error.code, message: raw, detail: raw } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import course", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(error.message);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Import course", exact: true })).toBeEnabled();
    await expect(page.locator("body")).not.toContainText(raw);
    if (error.code === "not_found") await screenshot(page, info, "import-error");
    await page.getByRole("button", { name: "Import course", exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(page.getByRole("button", { name: "Import course", exact: true })).toBeEnabled();
  });
}

for (const manifest of [recorded, live]) {
  test(`P5.5-AC2: imports recorded ${manifest.course.title} and lists the learning placeholder`, async ({ page }, info) => {
    let imported = false;
    await page.route("**/api/source/courses", route => route.fulfill({ json: imported ? [course(manifest)] : [] }));
    await page.route("**/api/source/connect", route => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postData()).toBeNull();
      imported = true;
      return route.fulfill({ json: { courseId: course(manifest).id, title: manifest.course.title, commitSha: manifest === live ? liveSha : sha } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import course", exact: true }).click();
    await expect(page).toHaveURL(/\/courses$/);
    await expect(page.getByRole("heading", { level: 2, name: manifest.course.title, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Learn this course", exact: true })).toBeDisabled();
    await expect(page.getByText("Course learning is not available yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveCount(0);
    if (manifest === live) await screenshot(page, info, "courses-not-ingested");
  });
}

test("import stays busy while PDFs download and prevents another request", async ({ page }) => {
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/source/connect", async route => {
    attempts++;
    await held;
    await route.fulfill({ json: { courseId: course().id, title: recorded.course.title, commitSha: sha } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import course", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "Importing…", exact: true })).toBeDisabled();
    await expect(page.getByText("Downloading the course PDFs. This may take a while.")).toBeVisible();
    await page.keyboard.press("Enter");
    expect(attempts).toBe(1);
  } finally { release(); }
  await expect(page).toHaveURL(/\/courses$/);
});

test("P5.5-AC2: an ingested course opens an encoded course id", async ({ page }, info) => {
  const saved = course(live, true);
  await page.route("**/api/source/courses", route => route.fulfill({ json: [saved] }));
  await page.goto("/courses");
  const open = page.getByRole("link", { name: "Open", exact: true });
  await expect(open).toHaveAttribute("href", `/course/${encodeURIComponent(saved.id)}`);
  await expect(page.getByRole("button", { name: "Learn this course" })).toHaveCount(0);
  await screenshot(page, info, "courses-ingested");
  await open.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/course/${encodeURIComponent(saved.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Plan, skills, worksheets" })).toBeVisible();
});

test("remembers a saved connection on import", async ({ page }, info) => {
  await page.route("**/api/source/courses", route => route.fulfill({ json: [course(live)] }));
  await page.goto("/");
  await expect(page.getByText(`Connected: ${live.course.title}.`, { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pick a course", exact: true })).toHaveAttribute("href", "/courses");
  await screenshot(page, info, "import-connected");
  await page.reload();
  await expect(page.getByText(`Connected: ${live.course.title}.`, { exact: false })).toBeVisible();
});

test("empty courses link back to import", async ({ page }, info) => {
  await page.goto("/courses");
  await expect(page.getByText("No courses yet.", { exact: true })).toBeVisible();
  await screenshot(page, info, "courses-empty");
  await page.getByRole("link", { name: "Import a course", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import course", exact: true })).toBeEnabled();
  await screenshot(page, info, "import-idle");
});

for (const failure of ["unknown code", "invalid JSON", "network failure"]) {
  test(`import handles ${failure} without upstream text`, async ({ page }) => {
    await page.route("**/api/source/connect", route => failure === "network failure" ? route.abort()
      : route.fulfill({ status: 502, ...(failure === "invalid JSON" ? { body: raw } : { json: { code: raw, message: raw } }) }));
    await page.goto("/");
    await page.getByRole("button", { name: "Import course", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(errors[3]!.message);
    await expect(page.getByRole("button", { name: "Import course", exact: true })).toBeEnabled();
    await expect(page.locator("body")).not.toContainText(raw);
  });
}

test("course list failure shows a fixed error and a path back to import", async ({ page }) => {
  await page.route("**/api/source/courses", route => route.fulfill({ status: 503, json: { code: "unavailable", message: raw } }));
  await page.goto("/courses");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(errors[3]!.message);
  await expect(page.getByRole("link", { name: "Back to import" })).toHaveAttribute("href", "/");
  await expect(page.getByText("No courses yet.", { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(raw);
});

test("malformed course data shows a fixed error instead of crashing", async ({ page }) => {
  await page.route("**/api/source/courses", route => route.fulfill({ json: [{ id: raw, ingested: "yes" }] }));
  await page.goto("/courses");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(errors[4]!.message);
  await expect(page.locator("body")).not.toContainText(raw);
});

test("P5.5-AC3: server token is absent from page HTML, loaded JavaScript and real cache/error responses", async ({ page, request }) => {
  const scripts: Array<Promise<{ url: string; body: string }>> = [];
  page.on("response", response => {
    if (response.request().resourceType() === "script") {
      scripts.push(response.text().then(body => ({ url: response.url(), body })));
    }
  });
  for (const path of ["/", "/courses"]) {
    const response = await page.goto(path);
    expect(response?.ok()).toBe(true);
    expect(await response!.text()).not.toContain(sentinel);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (path === "/") await expect(page.getByRole("button", { name: "Import course", exact: true })).toBeEnabled();
    else await expect(page.getByText("No courses yet.", { exact: true })).toBeVisible();
    expect(await page.content()).not.toContain(sentinel);
    await expect(page.locator('input[type="password"], input[type="text"], input:not([type]), textarea')).toHaveCount(0);
  }
  const loaded = await Promise.all(scripts);
  expect(loaded.length).toBeGreaterThan(0);
  for (const { url, body } of loaded) expect(body, url).not.toContain(sentinel);
  // APIRequestContext bypasses page.route: these exercise the actual offline server.
  const courses = await request.get("/api/source/courses");
  expect(courses.status()).toBe(200);
  expect(await courses.text()).not.toContain(sentinel);
  const error = await request.get("/api/files/p55-missing-cached-file");
  expect(error.status()).toBe(404);
  const errorBody = await error.text();
  expect(errorBody).not.toContain(sentinel);
  expect(JSON.parse(errorBody)).toEqual({ code: "not_found", message: errors[0]!.message });
});
