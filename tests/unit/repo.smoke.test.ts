import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ping: vi.fn(), getRepo: vi.fn() }));
vi.mock("../../src/lib/db", () => ({
  getRepo: mocks.getRepo,
  getMongoClient: vi.fn(),
}));
import { runDbCheck } from "../../scripts/smoke";

describe("database smoke line", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });
  it.each([true, false])("prints the database probe result (%s)", async ok => {
    mocks.ping.mockResolvedValue(ok);
    mocks.getRepo.mockReturnValue({ ping: mocks.ping });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runDbCheck()).toBe(ok);
    expect(log).toHaveBeenCalledWith("db", ok ? "ok" : "fail", expect.stringMatching(/^\d+ms$/));
  });
  it("reports configuration failures without leaking the error or credentials", async () => {
    mocks.getRepo.mockImplementation(() => { throw new Error("private connection string"); });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await runDbCheck()).toBe(false);
    expect(log).toHaveBeenCalledWith("db", "fail", expect.stringMatching(/^\d+ms$/));
  });
});
