import { expect, test } from "@playwright/test";

test("R2.1: compiled PDF page routes return safe cache-only 404s for encoded file ids", async ({ request }) => {
  // Exercise Next's compiled routes as well as the direct-handler unit tests:
  // bundling the native canvas addon used to fail even on an unknown-file request.
  const fileId = "github:o/r:manifest.json~course:1234567890123456789012345678901234567890:2026-11-14/f/notes%2FLecture%205.pdf";
  for (const suffix of ["pages", "page/1"]) {
    const response = await request.get(`/api/files/${encodeURIComponent(fileId)}/${suffix}`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "The course source or cached file was not found." });
  }
});

test("R2.1: recorded Worksheet 3 serves five regions and decodable PNGs through Next", async ({ page, request }) => {
  const worksheet = await request.get("/api/worksheet/calc2-ws3");
  expect(worksheet.status()).toBe(200);
  const body = await worksheet.json();
  expect(body.problems.map((problem: { region: { page: number } }) => problem.region.page)).toEqual([1, 1, 1, 2, 2]);
  const metadata = await request.get("/api/files/calc2-worksheet-3/pages");
  expect(await metadata.json()).toEqual([
    { page: 1, widthPt: 612, heightPt: 792 }, { page: 2, widthPt: 612, heightPt: 792 },
  ]);
  await page.goto("/");
  for (const n of [1, 2]) {
    const size = await page.evaluate(async n => {
      const response = await fetch(`/api/files/calc2-worksheet-3/page/${n}`);
      if (!response.ok) throw new Error(`PNG request failed: ${response.status}`);
      const image = await createImageBitmap(await response.blob());
      const size = [image.width, image.height];
      image.close();
      return size;
    }, n);
    expect(size).toEqual([1200, 1553]);
  }
  expect((await request.get("/api/files/calc2-worksheet-3/page/3")).status()).toBe(404);
  const missingWorksheet = await request.get("/api/worksheet/not-a-worksheet");
  expect(missingWorksheet.status()).toBe(404);
  expect(await missingWorksheet.json()).toMatchObject({ error: "not_found" });
});
