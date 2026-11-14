import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ping: vi.fn(), pingModel: vi.fn(), pingVision: vi.fn() }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => ({ ping: mocks.ping }), getMongoClient: vi.fn() }));
vi.mock("../../src/lib/llm", () => ({ pingModel: mocks.pingModel, pingVision: mocks.pingVision }));
import { readSnapshotKey, runSmoke, sameNumbers, SNAPSHOT_QUESTION } from "../../scripts/smoke";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "albert-smoke-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.resetAllMocks(); });

function snapshot(note: string): string {
  writeFileSync(join(dir, "s.png"), "png");
  writeFileSync(join(dir, "s.md"), note);
  return join(dir, "s.png");
}

it("--snapshot asks the plan's question about that image and checks the known answer", async () => {
  const png = snapshot("Source: ac4\n\nanswer: 7\n");
  mocks.pingVision.mockImplementation(async (probe: { accept: (a: string) => boolean }) => ({ ok: probe.accept("7"), ms: 5, answer: "7" }));
  expect(await runSmoke(["--snapshot", png])).toBe(true);
  const probe = mocks.pingVision.mock.calls[0]![0];
  expect(probe.imagePath).toBe(png);
  expect(probe.question.startsWith(SNAPSHOT_QUESTION)).toBe(true);
  expect(probe.accept("Cluster 7")).toBe(true);
  expect(probe.accept("6")).toBe(false);
  expect(vi.mocked(console.log).mock.calls).toEqual([["snapshot", "ok", "5ms", "7", "(expected 7)"]]);
  expect(mocks.ping).not.toHaveBeenCalled();
  expect(mocks.pingModel).not.toHaveBeenCalled();
});

it("--snapshot fails on a wrong answer, a missing note or a missing path", async () => {
  const png = snapshot("answer: 7");
  mocks.pingVision.mockResolvedValue({ ok: false, ms: 5, answer: "6" });
  expect(await runSmoke(["--snapshot", png])).toBe(false);
  expect(await runSmoke(["--snapshot", join(dir, "none.png")])).toBe(false);
  expect(await runSmoke(["--snapshot"])).toBe(false);
  expect(mocks.pingVision).toHaveBeenCalledOnce();
});

it("without --snapshot the default checks run unchanged", async () => {
  mocks.ping.mockResolvedValue(true);
  mocks.pingModel.mockResolvedValue({ ok: true, ms: 1, modelId: "m" });
  mocks.pingVision.mockResolvedValue({ ok: true, ms: 1, answer: "2 + 2 = 5" });
  expect(await runSmoke([])).toBe(true);
  expect(mocks.pingVision).toHaveBeenCalledWith();
});

it("reads the answer key and compares number sets", () => {
  expect(readSnapshotKey(snapshot("question: Which?\nanswer: 6, 7"))).toEqual({ question: "Which?", answer: [6, 7] });
  expect(() => readSnapshotKey(snapshot("no key here"))).toThrow("answer");
  expect(sameNumbers("6, 7", [7, 6])).toBe(true);
  expect(sameNumbers("7", [6, 7])).toBe(false);
  expect(sameNumbers("17", [7])).toBe(false);
  expect(sameNumbers("none", [7])).toBe(false);
  expect(sameNumbers("In row R2, d is 9 and x is 10.\n9, 10", [9, 10])).toBe(true);
  expect(sameNumbers("In row R2 it is 9, 10", [9, 10])).toBe(false);
});
