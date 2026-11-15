import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../src/lib/contracts";
import { createRunRegistry } from "../../src/lib/agent/registry";

const at = "2026-11-14T12:00:00.000Z";
const ev = (label: string): AgentEvent => ({ at, type: "tool", label });
const meta = { kind: "ingest", courseId: "c", studentId: "ada", threadId: "t", startedAt: at } as const;

describe("run registry (R1.2-AC2)", () => {
  it("attaches a second request to the running run and replays what it missed", () => {
    const registry = createRunRegistry(() => 0);
    const live = registry.start("ada:c", "run1", meta);
    live.emit(ev("one"));
    expect(registry.find("ada:c")).toBe(live);
    const seen: string[] = [];
    let ended = 0;
    live.subscribe((e) => seen.push(e.label), () => ended++);
    live.emit(ev("two"));
    expect(seen).toEqual(["one", "two"]);
    live.end("succeeded");
    expect(ended).toBe(1);
    expect(live.status).toBe("succeeded");
    live.emit(ev("late"));
    expect(live.events).toHaveLength(2);
  });

  it("refuses a second start while running, and allows one after the run ends", () => {
    const registry = createRunRegistry(() => 0);
    const first = registry.start("k", "a", meta);
    expect(() => registry.start("k", "b", meta)).toThrow();
    first.end("failed");
    expect(registry.start("k", "b", meta).runId).toBe("b");
  });

  it("subscribing to an ended run replays and ends at once; unsubscribe stops delivery", () => {
    const registry = createRunRegistry(() => 0);
    const live = registry.start("k", "a", meta);
    const seen: string[] = [];
    const off = live.subscribe((e) => seen.push(e.label), () => {});
    live.emit(ev("x"));
    off();
    live.emit(ev("y"));
    expect(seen).toEqual(["x"]);
    live.end("succeeded");
    let ended = false;
    const again: string[] = [];
    live.subscribe((e) => again.push(e.label), () => { ended = true; });
    expect(again).toEqual(["x", "y"]);
    expect(ended).toBe(true);
  });

  it("forgets an ended run after keepMs using the injected clock", () => {
    let t = 1000;
    const registry = createRunRegistry(() => t, 500);
    const live = registry.start("k", "a", meta);
    expect(registry.findById("a")).toBe(live);
    live.end("succeeded");
    t += 499;
    expect(registry.find("k")).toBe(live);
    t += 1;
    expect(registry.find("k")).toBeUndefined();
    expect(registry.findById("a")).toBeUndefined();
  });

  it("snapshot is a valid AgentRun with the done result", async () => {
    const { AgentRunSchema } = await import("../../src/lib/contracts");
    const live = createRunRegistry(() => Date.parse(at)).start("k", "a", meta);
    expect(AgentRunSchema.parse(live.snapshot()).status).toBe("running");
    live.emit({ at, type: "note", label: "done", detail: { cardsSaved: 5, worksheetsSaved: 4 } });
    live.end("succeeded");
    expect(AgentRunSchema.parse(live.snapshot())).toMatchObject({ status: "succeeded", result: { cardsSaved: 5, worksheetsSaved: 4 }, endedAt: at });
  });
});
