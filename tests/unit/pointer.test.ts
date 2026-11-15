import { describe, expect, it } from "vitest";
import { liveMarkTarget, POINTER_MS, pointerAt, pointerSteps, runMarkSteps, targetCentre } from "../../src/lib/ink/pointer";

describe("R3.4 conductor pointer", () => {
  it("runs pointer before mark and waits until the movement completes", async () => {
    const trace: string[] = [];
    let arrive!: () => void;
    const movement = new Promise<void>(resolve => { arrive = resolve; });
    const done = runMarkSteps(pointerSteps(true, false), {
      pointer: async () => { trace.push("pointer"); await movement; trace.push("arrived"); },
      mark: () => { trace.push("mark"); },
    });
    expect(trace).toEqual(["pointer"]);
    arrive(); await done;
    expect(trace).toEqual(["pointer", "arrived", "mark"]);
  });
  it.each([[true, true], [false, false], [false, true]])("skips the pointer for first=%s reduced=%s", async (first, reduced) => {
    const trace: string[] = [];
    await runMarkSteps(pointerSteps(first, reduced), { pointer: () => { trace.push("pointer"); }, mark: () => { trace.push("mark"); } });
    expect(trace).toEqual(["mark"]);
  });
  it("moves from the previous position to the real target centre in 300 ms", () => {
    const from = { x: 790, y: 300 }, to = targetCentre({ x: 100, y: 200, w: 60, h: 40 });
    expect(POINTER_MS).toBe(300);
    expect(pointerAt(from, to, 0)).toEqual(from);
    expect(pointerAt(from, to, 150)).toEqual({ x: 460, y: 260 });
    expect(pointerAt(from, to, 300)).toEqual(to);
    expect(pointerAt(from, to, 600)).toEqual(to);
    expect(pointerAt(from, to, -10)).toEqual(from);
  });
});


it("resolves live target ink, and skips empty/erased/stale/foreign-page targets", () => {
  const row = { id: "r1", problemId: "p1", page: 1, index: 1, bbox: { x: 0, y: 100, w: 1200, h: 100 } };
  const other = { ...row, id: "r2", page: 2 };
  const cluster = { id: "c1", rowId: "r1", label: 1, strokeIds: ["s1"], bbox: { x: 100, y: 120, w: 40, h: 20 } };
  expect(liveMarkTarget([row], [cluster], "p1", "r1", "r1", ["c1"])?.box).toEqual(cluster.bbox);
  expect(liveMarkTarget([row], [], "p1", "r1", "r1", ["c1"])).toBeNull();
  expect(liveMarkTarget([row], [cluster], "p1", "r1", "r1", ["erased-id"])).toBeNull();
  expect(liveMarkTarget([row], [cluster], "wrong-problem", "r1", "r1", ["c1"])).toBeNull();
  expect(liveMarkTarget([row, other], [{ ...cluster, rowId: "r2" }], "p1", "r1", "r2", ["c1"])).toBeNull();
});
