import { isAIMessage, ToolMessage } from "@langchain/core/messages";
import type { AgentEvent } from "../contracts";

type Pending = { name: string; label: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
const text = (value: unknown): string => typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);

/**
 * Turns the main graph's `streamMode: "updates"` chunks into AgentEvents (contracts §8).
 * Mapped here: write_todos -> todo; task -> subagent_start / subagent_end; write_file and
 * edit_file -> file; a final assistant message without tool calls -> note "summary" (runs.ts then ends the run with the contract's note "done").
 * Our own tools emit their `tool` events themselves (P6.3), so they are not mapped again.
 */
export function createEventMapper(now: () => Date): (chunk: unknown) => AgentEvent[] {
  const pending = new Map<string, Pending>();
  const at = () => now().toISOString();
  return (chunk) => {
    const events: AgentEvent[] = [];
    const nodes = asRecord(chunk);
    if (!nodes) return events;
    for (const update of Object.values(nodes)) {
      const messages = asRecord(update)?.messages;
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        if (isAIMessage(message)) {
          for (const call of message.tool_calls ?? []) {
            const args = asRecord(call.args) ?? {};
            if (call.name === "write_todos") {
              events.push({ at: at(), type: "todo", label: "Plan", detail: args.todos });
            } else if (call.name === "task") {
              const label = text(args.subagent_type) || "sub-agent";
              if (call.id) pending.set(call.id, { name: "task", label });
              events.push({ at: at(), type: "subagent_start", label, detail: args.description });
            } else if (call.name === "write_file" || call.name === "edit_file") {
              events.push({ at: at(), type: "file", label: text(args.file_path), detail: call.name });
            }
          }
          const final = message.text.trim();
          if (!message.tool_calls?.length && final) events.push({ at: at(), type: "note", label: "summary", detail: final });
        } else if (ToolMessage.isInstance(message)) {
          const start = pending.get(message.tool_call_id);
          if (start) {
            pending.delete(message.tool_call_id);
            events.push({ at: at(), type: "subagent_end", label: start.label, detail: text(message.content) });
          }
        }
      }
    }
    return events;
  };
}
