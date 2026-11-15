import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import type { CourseFile } from "../../src/lib/contracts";
import { MemoryRepo, MongoRepo } from "../../src/lib/db";
import type { Db } from "mongodb";
import { rasterizePdf, readCourseFile, TRANSCRIPTION_INSTRUCTION } from "../../src/lib/agent/functions/read-file";
const path = "fixtures/github/files/synthetic/pdf/unit-3/lecture-09.pdf";
const bytes = new Uint8Array(readFileSync(path));
const meta: CourseFile = { id: "lecture9", courseId: "c", unitId: "c/u3", title: "Lecture 9", mime: "application/pdf", bytes: bytes.length, kind: "lecture_notes" };
afterEach(() => { vi.unstubAllGlobals(); });
async function setup() { const repo = new MemoryRepo(); await repo.putFile(meta, bytes); return repo; }
it("AC3: two reads make one model call, set the cache id and keep the actual page count", async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled"); }));
  const repo = await setup(), model = { invoke: vi.fn(async () => ({ text: "--- page 1 ---\nfive-step recipe\nStep 2: find dx\nExample 2\n\\theta" })) };
  const first = await readCourseFile(meta.id, { repo, model });
  const second = await readCourseFile(meta.id, { repo, model });
  expect(first).toEqual(second);
  expect(first.pages).toBe((await PDFDocument.load(bytes)).getPageCount());
  expect(model.invoke).toHaveBeenCalledTimes(1);
  const saved = (await repo.getFile(meta.id))!;
  expect(saved.meta.textCacheId).toMatch(/text-v1-/);
  expect(await repo.getText(saved.meta.textCacheId!)).toBe(first.text);
  expect(fetch).not.toHaveBeenCalled();
});
it("sends the installed adapter's native Bedrock document block and exact transcription instruction", async () => {
  const repo = await setup();
  const invoke = vi.fn(async (messages: import("@langchain/core/messages").HumanMessage[]) => { void messages; return { text: "transcribed" }; });
  await readCourseFile(meta.id, { repo, model: { invoke }, provider: "bedrock" });
  expect(invoke.mock.calls[0]![0][0]!.content).toEqual([
    { type: "text", text: TRANSCRIPTION_INSTRUCTION },
    { type: "document", document: { name: "Course document", format: "pdf", source: { bytes }, citations: { enabled: true } } },
  ]);
});
it("explicitly requests reimport for missing cached bytes", async () => {
  const model = { invoke: vi.fn() };
  await expect(readCourseFile("missing", { repo: new MemoryRepo(), model })).rejects.toThrow(/reimport/);
  expect(model.invoke).not.toHaveBeenCalled();
});
it("regenerates a dangling text-cache reference", async () => {
  const repo = await setup(); await repo.putFile({ ...meta, textCacheId: "lost" }, bytes);
  const model = { invoke: vi.fn(async () => ({ text: "replacement" })) };
  expect((await readCourseFile(meta.id, { repo, model })).text).toBe("replacement");
  expect(model.invoke).toHaveBeenCalledOnce();
});
it.each(["", "   "])("does not cache empty text %j", async text => {
  const repo = await setup();
  await expect(readCourseFile(meta.id, { repo, model: { invoke: async () => ({ text }) } })).rejects.toThrow();
  expect((await repo.getFile(meta.id))?.meta.textCacheId).toBeUndefined();
});
it("rejects truncated text without saving it", async () => {
  const repo = await setup();
  await expect(readCourseFile(meta.id, { repo, model: { invoke: async () => ({ text: "partial", response_metadata: { stopReason: "max_tokens" } }) } })).rejects.toThrow(/truncated/);
  expect((await repo.getFile(meta.id))?.meta.textCacheId).toBeUndefined();
});
it("rasterises a rejected PDF, preserving page order and caching the combined text", async () => {
  const repo = await setup(), pages = (await PDFDocument.load(bytes)).getPageCount();
  const invoke = vi.fn(async () => ({ text: "page transcription" })).mockRejectedValueOnce(new Error("PDF document is not supported"));
  const rasterize = vi.fn(async () => Array.from({ length: pages }, () => new Uint8Array([1, 2, 3])));
  const result = await readCourseFile(meta.id, { repo, model: { invoke }, rasterize });
  expect(invoke).toHaveBeenCalledTimes(pages + 1);
  for (let n = 1; n <= pages; n++) expect(result.text).toContain(`--- page ${n} ---`);
  await readCourseFile(meta.id, { repo, model: { invoke }, rasterize });
  expect(invoke).toHaveBeenCalledTimes(pages + 1);
  expect(rasterize).toHaveBeenCalledOnce();
});
it("does not turn authentication failures into image calls", async () => {
  const repo = await setup(), rasterize = vi.fn();
  await expect(readCourseFile(meta.id, { repo, model: { invoke: async () => { throw new Error("AccessDeniedException"); } }, rasterize })).rejects.toThrow("AccessDenied");
  expect(rasterize).not.toHaveBeenCalled();
});
it("checks document limits before calling the provider", async () => {
  const repo = new MemoryRepo(), document = await PDFDocument.create();
  for (let n = 0; n < 101; n++) document.addPage();
  const large = await document.save(); await repo.putFile({ ...meta, bytes: large.length }, large);
  const invoke = vi.fn();
  await expect(readCourseFile(meta.id, { repo, model: { invoke } })).rejects.toThrow(/100-page/);
  expect(invoke).not.toHaveBeenCalled();
});
it("renders a real PDF to PNG locally", async () => {
  const images = await rasterizePdf(bytes);
  expect(images).toHaveLength((await PDFDocument.load(bytes)).getPageCount());
  for (const image of images) expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
}, 30000);
it("text cache upserts and distinguishes an empty entry from a missing one", async () => {
  const repo = new MemoryRepo(); expect(await repo.getText("x")).toBeNull();
  await repo.putText("x", "first"); await repo.putText("x", ""); expect(await repo.getText("x")).toBe("");
});
it("Mongo text cache uses its own collection and stable upsert key (offline driver fake)", async () => {
  const docs = new Map<string, object>();
  const collection = { createIndex: vi.fn(), replaceOne: vi.fn(async (filter: { _id: string }, value: object) => { docs.set(filter._id, value); }), findOne: vi.fn(async (filter: { _id: string }) => docs.get(filter._id) ?? null) };
  const db = { collection: vi.fn(() => collection) };
  const repo = new MongoRepo(db as unknown as Db);
  expect(await repo.getText("text1")).toBeNull();
  await repo.putText("text1", "first"); await repo.putText("text1", "second");
  expect(await repo.getText("text1")).toBe("second");
  expect(docs.size).toBe(1);
  expect(db.collection).toHaveBeenCalledWith("texts", { ignoreUndefined: true });
});
it("recognizes Bedrock's does-not-support-document rejection wording", async () => {
  const repo = await setup(), pages = (await PDFDocument.load(bytes)).getPageCount();
  const invoke = vi.fn(async () => ({ text: "text" })).mockRejectedValueOnce(new Error("This model does not support document content blocks"));
  const rasterize = vi.fn(async () => Array.from({ length: pages }, () => new Uint8Array([1])));
  await readCourseFile(meta.id, { repo, model: { invoke }, rasterize });
  expect(rasterize).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledTimes(pages + 1);
});
