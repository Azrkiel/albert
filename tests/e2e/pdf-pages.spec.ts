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
