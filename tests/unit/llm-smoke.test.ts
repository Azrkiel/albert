import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pingModel: vi.fn(), pingVision: vi.fn() }));
vi.mock("../../src/lib/llm", () => mocks);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pingModel.mockResolvedValue({ ok: true, ms: 42, modelId: "test-hint" });
  mocks.pingVision.mockResolvedValue({ ok: true, ms: 84, answer: "2 + 2 = 5" });
});
afterEach(() => vi.restoreAllMocks());

it("prints both model and vision lines", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { runModelChecks } = await import("../../scripts/smoke");
  expect(await runModelChecks()).toBe(true);
  expect(log.mock.calls).toEqual([
    ["model", "ok", "42ms", "test-hint"],
    ["vision", "ok", "84ms", "2 + 2 = 5"],
  ]);
});

it("reports failure but still checks vision", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.pingModel.mockResolvedValue({ ok: false, ms: 0, modelId: "" });
  const { runModelChecks } = await import("../../scripts/smoke");
  expect(await runModelChecks()).toBe(false);
  expect(log.mock.calls[0]).toEqual(["model", "fail", "0ms", "(HINT_MODEL_ID unset)"]);
  expect(mocks.pingVision).toHaveBeenCalledOnce();
});

it("fails when the vision check fails", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.pingVision.mockResolvedValue({ ok: false, ms: 2, answer: "2 + 2 = 4" });
  const { runModelChecks } = await import("../../scripts/smoke");
  expect(await runModelChecks()).toBe(false);
});
