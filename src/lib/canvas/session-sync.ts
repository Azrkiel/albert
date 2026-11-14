import type { SessionEvent } from "../contracts";

/** Sends one batch, oldest first. Rejects (or throws) when the batch did not reach the store. */
export type SyncTransport = (events: SessionEvent[]) => Promise<void>;
/** Best-effort send for page teardown (`navigator.sendBeacon`). Returns true when the browser queued it. */
export type BeaconSend = (events: SessionEvent[]) => boolean;

export type SessionSync = {
  /** Adds one event after everything already buffered. Never touches the network. */
  push(event: SessionEvent): void;
  /** Number of events not yet stored (including a batch in flight). */
  readonly pending: number;
  /**
   * Sends everything buffered as one batch. Resolves true when nothing is left unsent, false when the
   * transport failed (the batch stays buffered, ahead of later events, and goes out with the next flush).
   * Calling it while a batch is in flight joins that batch, then sends what arrived meanwhile.
   */
  flush(): Promise<boolean>;
  /**
   * Final flush on page hide. Sends the buffered events through `send` and drops them only if it returns
   * true. Skipped (returns false) while a batch is in flight: sending those events again could store
   * them twice, and ordering would no longer be guaranteed.
   */
  flushBeacon(send: BeaconSend): boolean;
};

/**
 * The buffer behind session sync (P2.8). Pure: it owns no timers and no network; the page calls
 * `flush` on its interval and supplies the transport. Events leave in the order they were pushed, one
 * batch at a time, and a failed batch is kept in front of newer events rather than dropped.
 */
export function createSessionSync(transport: SyncTransport): SessionSync {
  let queue: SessionEvent[] = [];
  let inFlight: Promise<boolean> | null = null;

  const send = (): Promise<boolean> => {
    const count = queue.length;
    if (count === 0) return Promise.resolve(true);
    const batch = queue.slice(0, count);
    const done = (async () => {
      try {
        await Promise.resolve().then(() => transport(batch)); // async even if it throws, so `inFlight` is set first
        queue = queue.slice(count);
        return true;
      } catch {
        return false;
      } finally {
        inFlight = null;
      }
    })();
    inFlight = done;
    return done;
  };

  return {
    push(event) { queue.push(event); },
    get pending() { return queue.length; },
    async flush() {
      // Join the batch in flight so batches never overlap, then send what arrived meanwhile.
      if (inFlight && !(await inFlight)) return false;
      return send();
    },
    flushBeacon(beacon) {
      if (inFlight || queue.length === 0) return queue.length === 0;
      let queued = false;
      try { queued = beacon(queue.slice()); } catch { queued = false; }
      if (queued) queue = [];
      return queued;
    },
  };
}
