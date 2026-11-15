import { describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../../src/lib/contracts";
import { createSessionState, reduceSessionEvent, type SessionState } from "../../src/lib/canvas/store";
import { historyEvent } from "../../src/lib/canvas/erase";
import { mergeRestoredEvents } from "../../src/lib/canvas/session-restore";
import { createSessionSync } from "../../src/lib/canvas/session-sync";

const initial = (): SessionState => ({ ...createSessionState(["p1"], "worksheet", undefined, "free"), surface: "pdf", fileId: "original" });
const event = (id: string, page = 1, at = 20): SessionEvent => ({ type: "stroke_end", at, stroke: {
  id, problemId: "p1", rowId: null, page, tool: "pen", pointerType: "pen", t0: at - 10, t1: at,
  points: [{ x: 100, y: 300, t: at - 10, p: 0.5 }, { x: 160, y: 320, t: at, p: 0.5 }], bbox: { x: 100, y: 300, w: 60, h: 20 },
} });

describe("R2.3 restore merge", () => {
  it("is idempotent and retains ids, points, pages and undo/redo stacks", () => {
    let written = [event("a"), event("b", 2, 30)].reduce(reduceSessionEvent, initial());
    written = reduceSessionEvent(written, historyEvent(written, "undo", 40, 1)!);
    const restored = mergeRestoredEvents(initial(), written.events);
    expect(restored.strokes).toEqual(written.strokes);
    expect(restored.rows).toEqual(written.rows);
    expect(restored.undoStack).toEqual(written.undoStack);
    expect(restored.redoStack).toEqual(written.redoStack);
    expect(mergeRestoredEvents(restored, written.events)).toBe(restored);
  });
  it("merges an overlapping event prefix without applying an erase twice", () => {
    const written = [event("a"), event("b", 2, 30)].reduce(reduceSessionEvent, initial());
    const undone = reduceSessionEvent(written, historyEvent(written, "undo", 40, 1)!);
    const prefix = mergeRestoredEvents(initial(), undone.events.slice(0, 2));
    const merged = mergeRestoredEvents(prefix, undone.events);
    expect(merged).toEqual(undone);
    expect(mergeRestoredEvents(merged, undone.events)).toBe(merged);
  });
  it("preserves unpaged ruled and free sessions on legacy surfaces without inventing PDF pages", () => {
    for (const layout of ["ruled", "free"] as const) {
      const raw = event("legacy");
      if (raw.type !== "stroke_end") throw new Error("test fixture");
      delete raw.stroke.page;
      const old = reduceSessionEvent(createSessionState(["p1"], "worksheet", undefined, layout), raw);
      const restored = mergeRestoredEvents(initial(), old.events);
      expect(restored.strokes).toEqual(old.strokes);
      expect(restored.layout).toBe(layout);
      expect(restored.surface).toBeUndefined();
      expect(mergeRestoredEvents(restored, old.events)).toBe(restored);
    }
  });
  it("restores pre-R2.3 raw null-row strokes followed by undo in either legacy layout", () => {
    for (const layout of ["ruled", "free"] as const) {
      const raw = event("legacy");
      if (raw.type !== "stroke_end") throw new Error("test fixture");
      delete raw.stroke.page;
      let old = reduceSessionEvent(createSessionState(["p1"], "worksheet", undefined, layout), raw);
      old = reduceSessionEvent(old, historyEvent(old, "undo", 40)!);
      const serverEvents = old.events.map(e => e.type === "stroke_end" ? { ...e, stroke: { ...e.stroke, rowId: null } } : e);
      const restored = mergeRestoredEvents(initial(), serverEvents);
      expect(restored.strokes).toEqual(old.strokes);
      expect(restored.layout).toBe(layout);
      expect(restored.undoStack).toEqual(old.undoStack);
      expect(restored.redoStack).toEqual(old.redoStack);
    }
  });
  it("restoration never enters sync; only new events are posted", async () => {
    const saved = [event("a"), event("b", 2, 30)].reduce(reduceSessionEvent, initial());
    const posted = vi.fn(async () => {});
    const sync = createSessionSync(posted);
    const restored = mergeRestoredEvents(initial(), saved.events);
    await sync.flush();
    expect(posted).not.toHaveBeenCalled();
    const fresh = event("c", 2, 50);
    reduceSessionEvent(restored, fresh);
    sync.push(fresh);
    await sync.flush();
    expect(posted).toHaveBeenCalledExactlyOnceWith([fresh]);
  });
});
