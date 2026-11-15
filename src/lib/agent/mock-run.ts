import { AgentRunSchema } from "../contracts";
import type { AgentEvent, AgentRun } from "../contracts";

/** Longest pause between two replayed events, so a mock run never stalls a test. */
export const MOCK_MAX_GAP_MS = 120;
export const MOCK_SPEED = 8;

/** Parses a stored run (fixtures/agent/ingest-run.json) as an AgentRun. */
export function parseStoredRun(json: unknown): AgentRun {
  return AgentRunSchema.parse(json);
}

/** Pause before each event: the recorded gap at 8x speed, capped. The first event has none. */
export function replayDelays(events: readonly AgentEvent[], speed = MOCK_SPEED, maxGapMs = MOCK_MAX_GAP_MS): number[] {
  return events.map((event, i) => {
    if (i === 0) return 0;
    const gap = Date.parse(event.at) - Date.parse(events[i - 1]!.at);
    return Math.min(Math.max(gap, 0) / speed, maxGapMs);
  });
}

/** Replays a stored run's events with the recorded rhythm. `sleep` is injected; `stamp` gives each replayed event a fresh time. */
export async function replayRun(run: AgentRun, emit: (event: AgentEvent) => void, sleep: (ms: number) => Promise<void>, stamp: () => string): Promise<"succeeded" | "failed"> {
  const delays = replayDelays(run.events);
  for (const [i, event] of run.events.entries()) {
    await sleep(delays[i]!);
    emit({ ...event, at: stamp() });
  }
  return run.events.some((e) => e.type === "error") ? "failed" : "succeeded";
}
