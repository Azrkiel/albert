import { describe, expect, it } from "vitest";
import { createSessionSync } from "../../src/lib/canvas";
import type { SessionEvent } from "../../src/lib/contracts";

const ev = (n: number): SessionEvent => ({ type: "problem_opened", at: n, problemId: `p${n}` });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const ats = (batches: SessionEvent[][]) => batches.flat().map((e) => e.at);

describe("P2.8-AC2 session sync buffer", () => {
  it("keeps a failed batch and sends it first, then the newer events, in order", async () => {
    const stored: SessionEvent[][] = [];
    let failNext = true;
    const sync = createSessionSync(async (events) => {
      if (failNext) { failNext = false; throw new Error("network down"); }
      stored.push(events);
    });
    sync.push(ev(1)); sync.push(ev(2));
    expect(await sync.flush()).toBe(false);
    expect(stored).toEqual([]);
    expect(sync.pending).toBe(2);
    sync.push(ev(3));
    expect(await sync.flush()).toBe(true);
    expect(ats(stored)).toEqual([1, 2, 3]);
    expect(sync.pending).toBe(0);
  });

  it("loses nothing across repeated failures", async () => {
    const stored: SessionEvent[] = [];
    let calls = 0;
    const sync = createSessionSync(async (events) => { if (++calls < 4) throw new Error("down"); stored.push(...events); });
    for (let i = 1; i <= 5; i++) { sync.push(ev(i)); await sync.flush(); }
    expect(stored.map((e) => e.at)).toEqual([1, 2, 3, 4, 5]);
  });

  it("a synchronously throwing transport counts as a failure and leaves the buffer usable", async () => {
    let throwing = true;
    const stored: SessionEvent[] = [];
    const sync = createSessionSync(() => { if (throwing) throw new Error("sync throw"); stored.push(...[]); return Promise.resolve(); });
    sync.push(ev(1));
    expect(await sync.flush()).toBe(false);
    throwing = false;
    expect(await sync.flush()).toBe(true);
    expect(sync.pending).toBe(0);
  });

  it("does nothing for an empty buffer", async () => {
    let calls = 0;
    const sync = createSessionSync(async () => { calls++; });
    expect(await sync.flush()).toBe(true);
    expect(calls).toBe(0);
  });

  it("events pushed while a batch is in flight go out after it, never overlapping", async () => {
    const batches: number[][] = [];
    let release: () => void = () => {};
    let active = 0; let maxActive = 0;
    const sync = createSessionSync(async (events) => {
      active++; maxActive = Math.max(maxActive, active);
      if (batches.length === 0) await new Promise<void>((resolve) => { release = resolve; });
      batches.push(events.map((e) => e.at));
      active--;
    });
    sync.push(ev(1));
    const first = sync.flush();
    sync.push(ev(2));
    const second = sync.flush(); // joins the first batch, then sends [2]
    await tick(); release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(batches).toEqual([[1], [2]]);
    expect(maxActive).toBe(1);
  });

  it("a flush that joined a failed batch reports failure and keeps everything", async () => {
    let fail = true;
    const stored: number[] = [];
    let release: () => void = () => {};
    const sync = createSessionSync(async (events) => {
      if (fail) { await new Promise<void>((resolve) => { release = resolve; }); throw new Error("down"); }
      stored.push(...events.map((e) => e.at));
    });
    sync.push(ev(1));
    const first = sync.flush();
    sync.push(ev(2));
    const second = sync.flush();
    await tick(); fail = false; release();
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(await sync.flush()).toBe(true);
    expect(stored).toEqual([1, 2]);
  });

  describe("flushBeacon", () => {
    it("sends the buffer and clears it when the browser queues it", () => {
      const sync = createSessionSync(async () => {});
      sync.push(ev(1)); sync.push(ev(2));
      let sent: number[] = [];
      expect(sync.flushBeacon((events) => { sent = events.map((e) => e.at); return true; })).toBe(true);
      expect(sent).toEqual([1, 2]);
      expect(sync.pending).toBe(0);
    });

    it("keeps the buffer when the beacon is refused or throws", () => {
      const sync = createSessionSync(async () => {});
      sync.push(ev(1));
      expect(sync.flushBeacon(() => false)).toBe(false);
      expect(sync.flushBeacon(() => { throw new Error("no beacon"); })).toBe(false);
      expect(sync.pending).toBe(1);
    });

    it("does not send while a batch is in flight (avoids storing events twice)", async () => {
      let release: () => void = () => {};
      const sync = createSessionSync(() => new Promise<void>((resolve) => { release = resolve; }));
      sync.push(ev(1));
      const flushing = sync.flush();
      let beacons = 0;
      expect(sync.flushBeacon(() => { beacons++; return true; })).toBe(false);
      expect(beacons).toBe(0);
      await tick(); release();
      await flushing;
      expect(sync.pending).toBe(0);
    });

    it("an empty buffer is already flushed", () => {
      expect(createSessionSync(async () => {}).flushBeacon(() => false)).toBe(true);
    });
  });
});
