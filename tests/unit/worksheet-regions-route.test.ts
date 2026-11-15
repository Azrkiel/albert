import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorksheetSchema, type Repo } from "../../src/lib/contracts";
import { MemoryRepo } from "../../src/lib/db/memory";

const state = vi.hoisted(() => ({ repo: null as Repo | null }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => state.repo }));
import { GET } from "../../src/app/api/worksheet/[worksheetId]/route";

const worksheet = WorksheetSchema.parse(JSON.parse(readFileSync("fixtures/worksheets/calc2-ws3.json", "utf8")));
const plain = { ...worksheet, problems: worksheet.problems.map(({ region, ...problem }) => { void region; return problem; }) };
const bytes = new Uint8Array(readFileSync("fixtures/github/files/synthetic/pdf/unit-3/worksheet-3.pdf"));
const meta = { id: worksheet.fileId, courseId: worksheet.courseId, title: worksheet.title, mime: "application/pdf", bytes: bytes.length, kind: "worksheet" as const };
const call = (worksheetId = worksheet.id) => GET(new Request("http://localhost/api/worksheet/x"), { params: Promise.resolve({ worksheetId }) });
beforeEach(async () => {
  state.repo = new MemoryRepo();
  await state.repo.upsertWorksheet(plain);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("serves validated PDF regions without changing the stored worksheet", async () => {
  await state.repo!.putFile(meta, bytes);
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(WorksheetSchema.parse(await response.json())).toEqual(worksheet);
  expect(await state.repo!.getWorksheet(worksheet.id)).toEqual(plain);
  expect(fetch).not.toHaveBeenCalled();
}, 30000);

it("returns a safe 404 for an unknown worksheet", async () => {
  const response = await call("missing%2Fworksheet");
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "not_found" });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps worksheets usable when the original is missing or has no labels", async () => {
  expect(await (await call()).json()).toEqual(plain);
  const blank = await PDFDocument.create(); blank.addPage([612, 792]);
  await state.repo!.putFile(meta, await blank.save());
  expect(await (await call()).json()).toEqual(plain);
}, 30000);

it("returns safe source failures without raw PDF or database error details", async () => {
  await state.repo!.putFile(meta, new TextEncoder().encode("private invalid source"));
  const invalid = await call();
  expect(invalid.status).toBe(502);
  expect(await invalid.text()).not.toContain("private invalid source");
  vi.spyOn(state.repo!, "getWorksheet").mockRejectedValue(new Error("private database URI"));
  const offline = await call();
  expect(offline.status).toBe(503);
  expect(await offline.text()).not.toContain("private database URI");
});
