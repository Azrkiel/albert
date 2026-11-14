import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ importGitHubCourse: vi.fn(), ping: vi.fn(), pingModel: vi.fn(), pingVision: vi.fn() }));
vi.mock("../../src/lib/lms", async importOriginal => ({ ...await importOriginal<typeof import("../../src/lib/lms")>(), importGitHubCourse: mocks.importGitHubCourse }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => ({ ping: mocks.ping }), getMongoClient: vi.fn() }));
vi.mock("../../src/lib/llm", () => ({ pingModel: mocks.pingModel, pingVision: mocks.pingVision }));
import { runSmoke } from "../../scripts/smoke";
import { CourseSourceError } from "../../src/lib/lms/adapter";

beforeEach(() => {
  vi.stubEnv("COURSE_GITHUB_REPO", "Azrkiel/albert-files");
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.ping.mockResolvedValue(true);
  mocks.pingModel.mockResolvedValue({ ok: true, ms: 1, modelId: "m" });
  mocks.pingVision.mockResolvedValue({ ok: true, ms: 1, answer: "2 + 2 = 5" });
  mocks.importGitHubCourse.mockResolvedValue({ title: "Actual course", unitIds: ["u1", "u2"], snapshot: { commitSha: "pinned", demoDay: "2026-11-14" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetAllMocks(); });

it("preserves database/model/vision checks and prints actual source title, unit count, SHA and day", async () => {
  expect(await runSmoke([])).toBe(true);
  expect(vi.mocked(console.log).mock.calls.map(c => c[0])).toEqual(["db", "model", "vision", "source"]);
  expect(console.log).toHaveBeenLastCalledWith("source", "ok", "Actual course", "2 units", "pinned", "2026-11-14");
});
it("--no-source skips GitHub even if configured", async () => {
  expect(await runSmoke(["--no-source"])).toBe(true);
  expect(mocks.importGitHubCourse).not.toHaveBeenCalled();
  expect(mocks.pingVision).toHaveBeenCalledOnce();
});
it("unconfigured smoke makes no source requests", async () => {
  vi.stubEnv("COURSE_GITHUB_REPO", "");
  expect(await runSmoke(["--no-llm"])).toBe(true);
  expect(mocks.importGitHubCourse).not.toHaveBeenCalled();
});
it("source failure fails smoke but preserves previous checks and sanitizes logs", async () => {
  mocks.importGitHubCourse.mockRejectedValue(new CourseSourceError("rate_limited"));
  expect(await runSmoke([])).toBe(false);
  expect(console.log).toHaveBeenLastCalledWith("source", "fail", "rate_limited");
  expect(mocks.pingModel).toHaveBeenCalledOnce();
  expect(mocks.pingVision).toHaveBeenCalledOnce();
});
it("unexpected failures are never logged verbatim", async () => {
  mocks.importGitHubCourse.mockRejectedValue(new Error("server-only-token"));
  expect(await runSmoke(["--no-llm"])).toBe(false);
  expect(console.log).toHaveBeenLastCalledWith("source", "fail", "unavailable");
});
