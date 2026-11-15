import { describe, expect, it } from "vitest";
import { hashSeed } from "../../src/lib/ink/marks";

describe("hashSeed", () => {
  it("is deterministic and never 0 (roughjs treats 0 as random)", () => {
    expect(hashSeed("mock-missing-dx-r1/circle")).toBe(hashSeed("mock-missing-dx-r1/circle"));
    for (const id of ["", "a", "hint-1", "mock-missing-dx-r1"]) expect(hashSeed(id)).toBeGreaterThan(0);
  });
  it("differs between ids", () => {
    expect(hashSeed("hint-a/circle")).not.toBe(hashSeed("hint-b/circle"));
  });
});
