import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AgentRunSchema } from "../../src/lib/contracts";
import { parseStoredRun, replayDelays, replayRun } from "../../src/lib/agent/mock-run";
import { elapsedLabel, eventLabel, parseSse, todoProgress } from "../../src/components/source/learn-progress";

const stored = () => JSON.parse(readFileSync("fixtures/agent/ingest-run.json", "utf8")) as unknown;

describe("fixtures/agent/ingest-run.json (R1.2-AC3)", () => {
  it("parses as an AgentRun that ended well and has the events the panel shows", () => {
    const run = AgentRunSchema.parse(stored());
    expect(run.kind).toBe("ingest");
    expect(run.status).toBe("succeeded");
    expect(run.events.some((e) => e.type === "todo")).toBe(true);
    expect(run.events.filter((e) => e.type === "subagent_start").length).toBeGreaterThanOrEqual(3);
    expect(run.events.at(-1)).toMatchObject({ type: "note", label: "done" });
    expect(JSON.stringify(run)).not.toMatch(/AKIA|ASIA|sk-[A-Za-z0-9]|Bearer |secret_|xai-/);
  });

  it("replays at 8x with capped gaps, and stamps fresh times", async () => {
    const run = parseStoredRun(stored());
    const delays = replayDelays(run.events);
    expect(delays[0]).toBe(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(120);
    expect(replayDelays([{ at: "2026-11-14T12:00:00Z", type: "note", label: "a" }, { at: "2026-11-14T12:00:08Z", type: "note", label: "b" }], 8, 5000)).toEqual([0, 1000]);
    const slept: number[] = [];
    const out: string[] = [];
    const status = await replayRun(run, (e) => out.push(e.at), async (ms) => { slept.push(ms); }, () => "2026-01-01T00:00:00.000Z");
    expect(status).toBe("succeeded");
    expect(out).toHaveLength(run.events.length);
    expect(new Set(out)).toEqual(new Set(["2026-01-01T00:00:00.000Z"]));
    expect(slept).toEqual(delays);
  });
});

describe("learn panel helpers", () => {
  it("reads n of m from the latest todo list", () => {
    const at = "2026-11-14T12:00:00.000Z";
    expect(todoProgress([])).toBeNull();
    expect(todoProgress([
      { at, type: "todo", label: "Plan", detail: [{ content: "a", status: "completed" }, { content: "b", status: "pending" }] },
      { at, type: "tool", label: "x" },
      { at, type: "todo", label: "Plan", detail: [{ content: "a", status: "completed" }, { content: "b", status: "completed" }, { content: "c", status: "pending" }] },
    ])).toEqual({ done: 2, total: 3 });
    expect(eventLabel({ at, type: "subagent_start", label: "unit-reader" })).toBe("Started unit-reader");
    expect(elapsedLabel(65_400)).toBe("1:05");
  });

  it("parses SSE messages across chunk boundaries and drops malformed ones", () => {
    const e = (label: string) => `data: ${JSON.stringify({ at: "2026-11-14T12:00:00.000Z", type: "tool", label })}\n\n`;
    const first = parseSse(e("a") + "data: {nope}\n\n" + e("b").slice(0, 20));
    expect(first.events.map((x) => x.label)).toEqual(["a"]);
    const second = parseSse(first.rest + e("b").slice(20));
    expect(second.events.map((x) => x.label)).toEqual(["b"]);
    expect(second.rest).toBe("");
  });
});
