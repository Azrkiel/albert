import { expect, it } from "vitest";
import { createSessionState, reduceSessionEvent, type SessionState } from "../../src/lib/canvas/store";
import { exportRecording, parseRecording } from "../../src/lib/canvas/recording";
import { mergeRestoredEvents } from "../../src/lib/canvas/session-restore";
import { historyEvent } from "../../src/lib/canvas/erase";
import { buildHintRequest } from "../../src/lib/canvas/hint-request";
import { planSnapshot } from "../../src/lib/canvas/snapshot";
import type { SessionEvent } from "../../src/lib/contracts";
const initial = (): SessionState => ({ ...createSessionState(["p1"], "ws", undefined, "free"), surface: "pdf", fileId: "original" });
const question: SessionEvent = { type: "hint_requested", at: 1, hintId: "h1", rowId: "p1/page1/question", rung: 1, question: "Why dx?", problemId: "p1", page: 1 };
const pen: SessionEvent = { type: "stroke_end", at: 20, stroke: { id: "s1", problemId: "p1", rowId: null, page: 1, tool: "pen", pointerType: "mouse", t0: 10, t1: 20, points: [{ x: 100, y: 300, t: 10, p: 0.5 }, { x: 140, y: 310, t: 20, p: 0.5 }], bbox: { x: 100, y: 300, w: 40, h: 10 } } };
it("empty PDF questions survive ink, undo, recording and idempotent restore without invented strokes", () => {
  let state = reduceSessionEvent(initial(), question);
  expect(state.strokes).toEqual([]); expect(state.clusters).toEqual({});
  expect(state.rows).toMatchObject([{ id: question.rowId, problemId: "p1", page: 1 }]);
  state = reduceSessionEvent(state, pen);
  expect(state.rows.at(-1)?.id).toBe(question.rowId);
  state = reduceSessionEvent(state, historyEvent(state, "undo", 30, 1)!);
  const recording = parseRecording(exportRecording(state, "synthetic question"));
  const restored = mergeRestoredEvents(initial(), recording.events);
  expect(restored).toEqual(state);
  expect(mergeRestoredEvents(restored, recording.events)).toBe(restored);
  expect(mergeRestoredEvents(initial(), [question]).surface).toBe("pdf");
});
it("rejects mismatched context ownership atomically", () => {
  const state = reduceSessionEvent(initial(), question);
  expect(() => reduceSessionEvent(state, { ...question, problemId: "other" })).toThrow();
  expect(() => reduceSessionEvent(state, { ...question, page: 2 })).toThrow();
  expect(state.events).toEqual([question]);
});
it.each(["ruled", "free"] as const)("supports a question before ink on the %s surface", layout => {
  const state = reduceSessionEvent(createSessionState(["p1"], "ws", undefined, layout), { ...question, page: undefined, rowId: "p1/question" });
  expect(state.rows.some(r => r.id === "p1/question")).toBe(true);
  expect(parseRecording(exportRecording(state, "legacy question")).events).toEqual(state.events);
});
it("carries cleaned question and earlier question/reply/new ink into a follow-up", async () => {
  let state = reduceSessionEvent(initial(), question);
  state = reduceSessionEvent(state, { type: "hint_shown", at: 5, hintId: "h1", marks: [{ id: "m1", hintId: "h1", problemId: "p1", drawnAt: 5, bbox: { x: 30, y: 1700, w: 300, h: 40 }, spec: { type: "writing", rowId: question.rowId, segments: [{ type: "text", text: "What changes?" }] } }] });
  state = reduceSessionEvent(state, pen);
  const request = await buildHintRequest(state, question.rowId, 1, "manual", { question: "  And\n now?  ", render: async args => {
    const plan = planSnapshot(args); return { png: "aGVsbG8=", width: plan.width, height: plan.height, rows: plan.rows };
  } });
  expect(request.question).toBe("And now?");
  expect(request.history).toEqual([{ hintId: "h1", rung: 1, rowId: question.rowId, question: "Why dx?", text: "What changes?", studentWroteAfter: true }]);
  expect(request.rows.at(-1)).toMatchObject({ rowId: question.rowId, clusterLabels: [] });
});
