import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintRequestSchema } from "../../src/lib/contracts";
import { POST } from "../../src/app/api/hint/route";
import { getRepo, seedDemo } from "../../src/lib/db";
import { demoSnapshotPng } from "../../src/lib/progress/demo-history";
import { saveHintSnapshot } from "../../src/lib/progress/snapshots";
import * as mock from "../../src/lib/tutor/mock";

const base = HintRequestSchema.parse(JSON.parse(await readFile("fixtures/eval/requests/missing-dx-r1.json", "utf8")));
beforeEach(() => { vi.stubEnv("MOCK_LLM", "1"); vi.stubEnv("STORE", "memory"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function setup(sessionId: string) {
  const repo = getRepo();
  await seedDemo(repo);
  await repo.createSession({ id: sessionId, studentId: "demo", courseId: "calc2", worksheetId: base.worksheetId, startedAt: new Date().toISOString() });
  const png = Buffer.from(await demoSnapshotPng()).toString("base64");
  return { repo, png, request: { ...base, sessionId, image: { ...base.image, marked: png } } };
}

describe("P7.4-AC3 the snapshot is saved after the hint, never before", () => {
  it("writes `done` to the response before putFile resolves, then links the file to the stored hint", async () => {
    const stream = mock.streamMockHint;
    vi.spyOn(mock, "streamMockHint").mockImplementation((fixture) => stream(fixture, async () => {}));
    const { repo, request } = await setup("snap-1");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = repo.putFile.bind(repo);
    const putFile = vi.spyOn(repo, "putFile").mockImplementation(async (meta, bytes) => { await gate; await original(meta, bytes); });

    const response = await POST(new Request("http://localhost/api/hint", { method: "POST", body: JSON.stringify(request) }));
    const text = await response.text(); // the whole response, including the done event, is already delivered
    expect(text).toContain('"type":"done"');
    await vi.waitFor(() => expect(putFile).toHaveBeenCalledOnce()); // started, but still waiting on the gate
    const [stored] = await repo.listHints({ sessionId: "snap-1" });
    expect(stored).toBeDefined();
    expect(stored!.snapshotFileId).toBeUndefined();

    release();
    await vi.waitFor(async () => expect((await repo.listHints({ sessionId: "snap-1" }))[0]!.snapshotFileId).toMatch(/^snapshot-/));
    const linked = (await repo.listHints({ sessionId: "snap-1" }))[0]!;
    const file = await repo.getFile(linked.snapshotFileId!);
    expect(file?.meta.mime).toBe("image/png");
    expect(Buffer.from(file!.bytes).toString("base64")).toBe(request.image.marked);
  });

  it("a failing putFile never breaks the hint", async () => {
    const stream = mock.streamMockHint;
    vi.spyOn(mock, "streamMockHint").mockImplementation((fixture) => stream(fixture, async () => {}));
    const { repo, request } = await setup("snap-2");
    const putFile = vi.spyOn(repo, "putFile").mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(new Request("http://localhost/api/hint", { method: "POST", body: JSON.stringify(request) }));
    expect(await response.text()).toContain('"type":"done"');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("Hint snapshot not saved"));
    expect(putFile).toHaveBeenCalled();
  });

  it("ignores bytes that are not a PNG, and hints that were never stored", async () => {
    const { repo } = await setup("snap-3");
    expect(await saveHintSnapshot(repo, { sessionId: "snap-3", hintId: "nope", imageBase64: Buffer.from("not a png at all").toString("base64") })).toBeUndefined();
    const png = Buffer.from(await demoSnapshotPng()).toString("base64");
    expect(await saveHintSnapshot(repo, { sessionId: "snap-3", hintId: "nope", imageBase64: png })).toBeUndefined();
  });
});
