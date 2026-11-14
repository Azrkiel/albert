import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ping: vi.fn(), pingModel: vi.fn(), pingVision: vi.fn() }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => ({ ping: mocks.ping }), getMongoClient: vi.fn() }));
vi.mock("../../src/lib/llm", () => ({ pingModel: mocks.pingModel, pingVision: mocks.pingVision }));
import { runSmoke } from "../../scripts/smoke";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.ping.mockResolvedValue(true);
  mocks.pingModel.mockResolvedValue({ ok: true, ms: 1, modelId: "m" });
  mocks.pingVision.mockResolvedValue({ ok: true, ms: 1, answer: "2 + 2 = 5" });
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

it("prints db, model and vision lines and passes when all succeed", async () => {
  expect(await runSmoke([])).toBe(true);
  expect(vi.mocked(console.log).mock.calls.map(c => c[0])).toEqual(["db", "model", "vision"]);
});

it("--no-llm skips the model and vision checks", async () => {
  mocks.pingModel.mockResolvedValue({ ok: false, ms: 1, modelId: "" });
  expect(await runSmoke(["--no-llm"])).toBe(true);
  expect(mocks.pingModel).not.toHaveBeenCalled();
  expect(mocks.pingVision).not.toHaveBeenCalled();
});

it("--no-source is accepted and the checks still run", async () => {
  expect(await runSmoke(["--no-source"])).toBe(true);
  expect(mocks.pingVision).toHaveBeenCalledOnce();
});

it("fails when the database fails even if the model passes", async () => {
  mocks.ping.mockResolvedValue(false);
  expect(await runSmoke([])).toBe(false);
  expect(mocks.pingModel).toHaveBeenCalledOnce();
});

it("fails when an attempted model check fails", async () => {
  mocks.pingVision.mockResolvedValue({ ok: false, ms: 1, answer: "" });
  expect(await runSmoke([])).toBe(false);
});
