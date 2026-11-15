import { readFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";
import { degrees, PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CourseFile, Repo } from "../../src/lib/contracts";
import { MemoryRepo } from "../../src/lib/db/memory";

const state = vi.hoisted(() => ({ repo: null as Repo | null }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => state.repo }));
import { GET as pages } from "../../src/app/api/files/[fileId]/pages/route";
import { GET as page } from "../../src/app/api/files/[fileId]/page/[n]/route";

const bytes = new Uint8Array(readFileSync("fixtures/github/files/synthetic/pdf/unit-3/worksheet-3.pdf"));
const meta: CourseFile = { id: "worksheet%2F3", courseId: "calc2", title: "Worksheet 3", mime: "application/pdf", bytes: bytes.length, kind: "worksheet" };
const request = new Request("http://localhost/api/files/worksheet/pages");
const params = (n = "1", fileId = meta.id) => ({ params: Promise.resolve({ fileId, n }) });

beforeEach(async () => {
  state.repo = new MemoryRepo();
  await state.repo.putFile(meta, bytes);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("R2.1-AC2: lists every page with PDF point sizes matching pdf-lib", async () => {
  const response = await pages(request, params());
  expect(response.status).toBe(200);
  const document = await PDFDocument.load(bytes);
  expect(await response.json()).toEqual(document.getPages().map((p, i) => ({ page: i + 1, widthPt: p.getWidth(), heightPt: p.getHeight() })));
  expect(fetch).not.toHaveBeenCalled();
});

it("R2.1-AC2: decodes each single page at 1200px wide, caches derived PNGs and retains original bytes", async () => {
  const put = vi.spyOn(state.repo!, "putFile");
  for (const n of ["1", "2"]) {
    const response = await page(request, params(n));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const png = new Uint8Array(await response.arrayBuffer());
    const image = await loadImage(Buffer.from(png));
    expect(image.width).toBe(1200);
    expect(image.height).toBe(Math.round(1200 * 792 / 612));
    const again = await page(request, params(n));
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(png);
  }
  expect(put).toHaveBeenCalledTimes(2);
  for (const [derived, png] of put.mock.calls) {
    expect(derived).toMatchObject({ courseId: meta.courseId, mime: "image/png", bytes: png.length, kind: "other" });
    expect(derived.id).not.toBe(meta.id);
    expect((await state.repo!.getFile(derived.id))!.bytes).toEqual(png);
  }
  expect((await state.repo!.getFile(meta.id))!.bytes).toEqual(bytes);
  expect(fetch).not.toHaveBeenCalled();
}, 30000);

it("invalidates a derived page when the bytes behind a file id change", async () => {
  const original = new Uint8Array(await (await page(request, params())).arrayBuffer());
  const document = await PDFDocument.create();
  document.addPage([612, 400]);
  const replacement = await document.save();
  await state.repo!.putFile({ ...meta, bytes: replacement.length }, replacement);
  const changed = new Uint8Array(await (await page(request, params())).arrayBuffer());
  expect(changed).not.toEqual(original);
  expect((await loadImage(Buffer.from(changed))).height).toBe(Math.round(1200 * 400 / 612));
}, 30000);

it.each(["0", "-1", "1.5", "01", "nope", "3", "999999999999999999999"])("rejects invalid or missing page %s", async n => {
  expect((await page(request, params(n))).status).toBe(404);
});

it("R2.1-AC2: unknown files return safe 404s without fetching a URL", async () => {
  for (const response of [await pages(request, params("1", "https://example.org/secret")), await page(request, params("1", "missing"))]) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "The course source or cached file was not found." });
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("returns a safe source error for a malformed PDF or a non-PDF", async () => {
  for (const mime of ["application/pdf", "text/plain"]) {
    await state.repo!.putFile({ ...meta, mime }, new TextEncoder().encode("private bad PDF text"));
    for (const response of [await pages(request, params()), await page(request, params())]) {
      expect(response.status).toBe(502);
      const body = await response.text();
      expect(body).toContain('"code":"bad_reply"');
      expect(body).not.toContain("private bad PDF text");
    }
  }
});

it("uses the displayed crop and rotation for page dimensions and PNG aspect", async () => {
  const document = await PDFDocument.create();
  const p = document.addPage([612, 792]);
  p.setCropBox(20, 30, 400, 600);
  p.setRotation(degrees(90));
  const rotated = await document.save();
  await state.repo!.putFile({ ...meta, bytes: rotated.length }, rotated);
  expect(await (await pages(request, params())).json()).toEqual([{ page: 1, widthPt: 600, heightPt: 400 }]);
  const image = await loadImage(Buffer.from(await (await page(request, params())).arrayBuffer()));
  expect([image.width, image.height]).toEqual([1200, 800]);
}, 30000);
