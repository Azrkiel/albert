import type { AgentEvent, AgentRun } from "../contracts";

type Listener = (event: AgentEvent) => void;

/** One run being followed: what it has emitted so far plus the requests attached to it. */
/** What the registry needs to describe a run as an AgentRun. */
export type RunMeta = Pick<AgentRun, "kind" | "courseId" | "studentId" | "threadId" | "startedAt">;

export type LiveRun = {
  readonly runId: string;
  readonly key: string;
  readonly events: readonly AgentEvent[];
  readonly status: AgentRun["status"];
  /** Replays every event so far to `onEvent`, then forwards new ones; `onEnd` fires once when the run is over. Returns an unsubscribe. */
  subscribe(onEvent: Listener, onEnd: () => void): () => void;
  /** The run so far, shaped as an AgentRun (events, status, and the result once a "done" note arrived). */
  snapshot(): AgentRun;
  emit(event: AgentEvent): void;
  end(status: "succeeded" | "failed"): void;
};

export type RunRegistry = {
  /** The run currently going for this key, or one that ended less than `keepMs` ago. */
  find(key: string): LiveRun | undefined;
  findById(runId: string): LiveRun | undefined;
  /** Starts a run for the key. Throws if one is already running; callers `find` first and attach instead. */
  start(key: string, runId: string, meta: RunMeta): LiveRun;
};

/**
 * Pure map of live runs. No timers, network or global clock: time comes in as `now`.
 * A second request for the same key attaches to the running run instead of starting another.
 */
export function createRunRegistry(now: () => number = Date.now, keepMs = 30_000): RunRegistry {
  const byKey = new Map<string, { run: LiveRun; endedAt?: number }>();

  const expire = () => {
    for (const [key, entry] of byKey) if (entry.endedAt !== undefined && now() - entry.endedAt >= keepMs) byKey.delete(key);
  };

  return {
    find(key) { expire(); return byKey.get(key)?.run; },
    findById(runId) { expire(); for (const { run } of byKey.values()) if (run.runId === runId) return run; return undefined; },
    start(key, runId, meta) {
      expire();
      const existing = byKey.get(key);
      if (existing && existing.run.status === "running") throw new Error("A run is already going for this key.");
      const events: AgentEvent[] = [];
      const listeners = new Set<{ onEvent: Listener; onEnd: () => void }>();
      let status: AgentRun["status"] = "running";
      let endedAt: number | undefined;
      const entry: { run: LiveRun; endedAt?: number } = {
        run: {
          runId, key, events,
          get status() { return status; },
          subscribe(onEvent, onEnd) {
            for (const event of events) onEvent(event);
            if (status !== "running") { onEnd(); return () => {}; }
            const listener = { onEvent, onEnd };
            listeners.add(listener);
            return () => { listeners.delete(listener); };
          },
          snapshot() {
            const done = events.find((e) => e.type === "note" && e.label === "done");
            const result = typeof done?.detail === "object" && done.detail !== null ? done.detail as NonNullable<AgentRun["result"]> : undefined;
            return { id: runId, ...meta, status, events: [...events], ...(result ? { result } : {}), ...(endedAt === undefined ? {} : { endedAt: new Date(endedAt).toISOString() }) };
          },
          emit(event) {
            if (status !== "running") return;
            events.push(event);
            for (const l of [...listeners]) l.onEvent(event);
          },
          end(next) {
            if (status !== "running") return;
            status = next;
            endedAt = now();
            entry.endedAt = endedAt;
            for (const l of [...listeners]) l.onEnd();
            listeners.clear();
          },
        },
      };
      byKey.set(key, entry);
      return entry.run;
    },
  };
}

const shared = globalThis as typeof globalThis & { albertRunRegistry?: RunRegistry };
/** The server's one registry, shared across route bundles like the Repo. */
export function getRunRegistry(): RunRegistry {
  return shared.albertRunRegistry ??= createRunRegistry();
}
