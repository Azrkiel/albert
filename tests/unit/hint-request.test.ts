import { describe, expect, it, vi } from "vitest";
import { HintRequestSchema, PAGE, type AlbertMark, type SessionEvent, type Stroke } from "../../src/lib/contracts";
import { buildHintRequest, createSessionState, localSessionId, planSnapshot, reduceSessionEvent, type Snapshot, type SnapshotArgs, type SessionState } from "../../src/lib/canvas";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
const rowY = (index: number) => PAGE.statementMinHeight + (index - 1) * PAGE.rowHeight + 20;

function pen(id: string, row: number, x: number, t: number, problemId = "p1"): Stroke {
  const y = rowY(row);
  return { id, problemId, rowId: null, tool: "pen", pointerType: "mouse",
    points: [{ x, y, t, p: 0.5 }, { x: x + 20, y: y + 20, t: t + 10, p: 0.5 }],
    t0: t, t1: t + 10, bbox: { x, y, w: 20, h: 20 } };
}

/** The canvas is browser-only; the stub returns the real plan's rows and size with a fixed PNG. */
const render = vi.fn(async (args: SnapshotArgs): Promise<Snapshot> => {
  const plan = planSnapshot(args);
  return { png: args.marked ? PNG : `${PNG}clean`, width: plan.width, height: plan.height, rows: plan.rows };
});

function writing(hintId: string, rowId: string, problemId: string, at: number): AlbertMark {
  return { id: `m_${hintId}`, hintId, problemId, drawnAt: at, bbox: { x: 800, y: 100, w: 300, h: 40 },
    spec: { type: "writing", rowId, segments: [{ type: "text", text: "What is " }, { type: "math", latex: "dx" }, { type: "break" }, { type: "text", text: "in θ?" }] } };
}

function apply(state: SessionState, ...events: SessionEvent[]): SessionState {
  return events.reduce(reduceSessionEvent, state);
}

function session(): SessionState {
  return apply(createSessionState(["p1", "p2"], "ws1"),
    { type: "stroke_end", at: 10, stroke: pen("a", 1, 100, 0) },
    { type: "stroke_end", at: 110, stroke: pen("b", 1, 200, 100) },
    { type: "stroke_end", at: 210, stroke: pen("c", 2, 100, 200) });
}

describe("buildHintRequest (P2.7-AC5)", () => {
  it("empty history: output parses as HintRequest with the marked image and rows 1..stuck", async () => {
    const request = await buildHintRequest(session(), "p1/r2", 1, "pause", { render });
    expect(HintRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ sessionId: localSessionId("ws1"), worksheetId: "ws1", problemId: "p1", rowId: "p1/r2",
      rung: 1, trigger: "pause", history: [], image: { marked: PNG } });
    expect(request.image.clean).toBeUndefined();
    expect(request.rows).toEqual([{ rowId: "p1/r1", index: 1, clusterLabels: [1, 2] }, { rowId: "p1/r2", index: 2, clusterLabels: [1] }]);
    expect(request.image.width).toBeGreaterThan(0);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ problemId: "p1", upToRowId: "p1/r2", marked: true }));
  });

  it("history comes from hint_shown events on this problem, oldest first, with rung, text and later ink", async () => {
    const state = apply(session(),
      { type: "hint_requested", at: 300, hintId: "h1", rowId: "p1/r1", rung: 1 },
      { type: "hint_shown", at: 400, hintId: "h1", marks: [writing("h1", "p1/r1", "p1", 400)] },
      { type: "stroke_end", at: 510, stroke: pen("d", 3, 100, 500) },
      { type: "hint_requested", at: 600, hintId: "other", rowId: "p2/r1", rung: 1 },
      { type: "hint_shown", at: 700, hintId: "other", marks: [writing("other", "p2/r1", "p2", 700)] },
      { type: "hint_requested", at: 800, hintId: "h2", rowId: "p1/r3", rung: 2 },
      { type: "hint_shown", at: 900, hintId: "h2", marks: [writing("h2", "p1/r3", "p1", 900)] },
      { type: "stroke_end", at: 1010, stroke: pen("e", 1, 100, 1000, "p2") });
    const request = await buildHintRequest(state, "p1/r3", 3, "manual", { render, sessionId: "s_123", clean: true });
    expect(HintRequestSchema.parse(request)).toEqual(request);
    expect(request.sessionId).toBe("s_123");
    expect(request.image.clean).toBe(`${PNG}clean`);
    expect(request.history).toEqual([
      { hintId: "h1", rung: 1, rowId: "p1/r1", text: "What is $dx$\nin θ?", studentWroteAfter: true },
      { hintId: "h2", rung: 2, rowId: "p1/r3", text: "What is $dx$\nin θ?", studentWroteAfter: false },
    ]);
  });

  it("rejects an unknown row", async () => {
    await expect(buildHintRequest(session(), "p1/r99", 1, "manual", { render })).rejects.toThrow("Unknown row");
  });
});
