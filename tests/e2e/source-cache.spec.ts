import { expect, test } from "@playwright/test";

test("source list reads the offline cache without importing GitHub", async ({ request }) => {
  const response = await request.get("/api/source/courses");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual([]);
});

test("encoded snapshot file ids reach the cache route and never fall back to GitHub", async ({ request }) => {
  const id = "github:o/r:manifest.json~course:1234567890123456789012345678901234567890:2026-11-14/f/notes%2FLecture%205.pdf";
  const response = await request.get(`/api/files/${encodeURIComponent(id)}`);
  expect(response.status()).toBe(404);
  expect(await response.json()).toMatchObject({ code: "not_found" });
});
