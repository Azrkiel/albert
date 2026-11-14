import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HintRequestSchema } from "../../src/lib/contracts";
import { loadMockHint, streamMockHint } from "../../src/lib/tutor/mock";

vi.mock("node:fs/promises", { spy: true });

const request = HintRequestSchema.parse(JSON.parse(await readFile("fixtures/eval/requests/missing-dx-r1.json", "utf8")));
afterEach(() => vi.restoreAllMocks());

describe("mock lookup", () => {
  it("explicit fixtureId wins over the derived name", async () => {
    expect((await loadMockHint({ ...request, fixtureId: "default-r2" })).fixtureId).toBe("default-r2");
  });
  it("uses the problem id with slashes replaced by underscores", async () => {
    expect((await loadMockHint(request)).fixtureId).toBe("calc2-ws3_p1-r1");
  });
  it.each([1, 2, 3] as const)("falls back to the matching default rung %i", async (rung) => {
    expect((await loadMockHint({ ...request, problemId: "unknown/p1", rung })).fixtureId).toBe(`default-r${rung}`);
  });
  it.each(["../x", "", "/x", "x.json", "%2e%2e", "x\\y"])("rejects unsafe fixtureId %j", async (fixtureId) => {
    await expect(loadMockHint({ ...request, fixtureId })).rejects.toThrow("Invalid hint fixtureId");
  });
  it("rejects unsafe derived paths as well", async () => {
    await expect(loadMockHint({ ...request, problemId: "../../x" })).rejects.toThrow("Invalid hint problemId");
  });
  it("does not silently fall back when an explicit fixture is missing", async () => {
    await expect(loadMockHint({ ...request, fixtureId: "missing-fixture" })).rejects.toThrow();
  });
  it("parses the fixture with MockHint, rejecting malformed contents instead of falling back", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ fixtureId: "bad", events: [], delaysMs: [1] }));
    await expect(loadMockHint(request)).rejects.toThrow("One delay is required per event");
  });
  it("waits each injected delay before yielding its corresponding event", async () => {
    const mock = await loadMockHint(request);
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const events = [];
    for await (const event of streamMockHint(mock, sleep)) {
      expect(sleep).toHaveBeenCalledTimes(events.length + 1);
      events.push(event);
    }
    expect(events).toEqual(mock.events);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(mock.delaysMs);
  });
});
