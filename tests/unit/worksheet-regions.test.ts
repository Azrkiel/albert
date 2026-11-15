import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { WorksheetSchema } from "../../src/lib/contracts";
import { MemoryRepo } from "../../src/lib/db/memory";
import { worksheetWithRegions } from "../../src/lib/lms/pdf-files";

const worksheet = WorksheetSchema.parse(JSON.parse(readFileSync("fixtures/worksheets/calc2-ws3.json", "utf8")));
const withoutRegions = { ...worksheet, problems: worksheet.problems.map(({ region, ...problem }) => { void region; return problem; }) };
const bytes = new Uint8Array(readFileSync("fixtures/github/files/synthetic/pdf/unit-3/worksheet-3.pdf"));

it("fills served worksheet regions from the cached PDF without changing stored course knowledge", async () => {
  const repo = new MemoryRepo();
  await repo.upsertWorksheet(withoutRegions);
  await repo.putFile({ id: worksheet.fileId, courseId: worksheet.courseId, title: worksheet.title, mime: "application/pdf", bytes: bytes.length, kind: "worksheet" }, bytes);
  const stored = await repo.getWorksheet(worksheet.id);
  const enriched = await worksheetWithRegions(repo, stored!);
  expect(enriched).toEqual(worksheet);
  expect(await repo.getWorksheet(worksheet.id)).toEqual(withoutRegions);
  expect(WorksheetSchema.parse(enriched)).toEqual(enriched);
}, 30000);

it("retains legacy worksheets with no original and leaves no-label pages for the picker", async () => {
  const repo = new MemoryRepo();
  expect(await worksheetWithRegions(repo, withoutRegions)).toEqual(withoutRegions);
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  const blank = await document.save();
  await repo.putFile({ id: worksheet.fileId, courseId: worksheet.courseId, title: worksheet.title, mime: "application/pdf", bytes: blank.length, kind: "worksheet" }, blank);
  // Old region coordinates must not survive replacement by an unlabelled PDF.
  expect(await worksheetWithRegions(repo, worksheet)).toEqual(withoutRegions);
}, 30000);

it("does not hide Repo failures as an empty-region fallback", async () => {
  const repo = new MemoryRepo();
  vi.spyOn(repo, "getFile").mockRejectedValue(new Error("store offline"));
  await expect(worksheetWithRegions(repo, worksheet)).rejects.toThrow("store offline");
});
