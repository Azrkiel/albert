import { z } from "zod";
import { AgentEventSchema } from "../../lib/contracts";
import type { AgentEvent } from "../../lib/contracts";

const TodoSchema = z.array(z.object({ content: z.string(), status: z.string() }));

/** n of m from the latest todo list the agent wrote; null until it has written one. */
export function todoProgress(events: readonly AgentEvent[]): { done: number; total: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== "todo") continue;
    const todos = TodoSchema.safeParse(event.detail);
    if (todos.success && todos.data.length > 0) return { done: todos.data.filter((t) => t.status === "completed").length, total: todos.data.length };
  }
  return null;
}

/** One short line for the latest event: labels the app wrote or file names, never model prose. */
export function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "todo": return "Updated the to-do list";
    case "subagent_start": return `Started ${event.label}`;
    case "subagent_end": return `Finished ${event.label}`;
    case "file": return `Wrote ${event.label}`;
    case "tool": return event.label;
    case "note": return event.label === "done" ? "Done" : "Working";
    case "error": return "Stopped";
  }
}

export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Splits an SSE buffer into complete `data:` messages and the unfinished rest. Malformed or unknown messages are dropped. */
export function parseSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AgentEvent[] = [];
  for (const part of parts) {
    const data = part.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data) continue;
    try {
      const parsed = AgentEventSchema.safeParse(JSON.parse(data));
      if (parsed.success) events.push(parsed.data);
    } catch { /* ignore malformed message */ }
  }
  return { events, rest };
}
