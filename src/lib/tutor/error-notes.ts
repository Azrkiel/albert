import type { HintErrorCode, HintEvent } from "../contracts";

// P3.8: the margin note for each error. Raw server messages are never shown to the student.
export const HINT_ERROR_NOTES: Readonly<Record<HintErrorCode, string>> = {
  model_unavailable: "Albert can't reach his notes right now. Try again.",
  bad_model_output: "Albert couldn't read that. Try again?",
  timeout: "That took too long. Try again?",
  bad_request: "That hint didn't go through. Try again.",
};

/**
 * Failures the browser detects itself, and the code each one is shown as:
 * - `http_400`: the route rejected the request body → `bad_request`.
 * - `http_error`: any other non-2xx status, or no body → `model_unavailable`.
 * - `network`: fetch or a read threw (connection lost) → `model_unavailable`.
 * - `truncated`: the stream ended before `done` → `model_unavailable`.
 * - `invalid_line`: a line was not JSON or not a `HintEvent` → `bad_model_output`.
 */
export type ClientHintFailure = "http_400" | "http_error" | "network" | "truncated" | "invalid_line";

export const CLIENT_FAILURE_CODES: Readonly<Record<ClientHintFailure, HintErrorCode>> = {
  http_400: "bad_request",
  http_error: "model_unavailable",
  network: "model_unavailable",
  truncated: "model_unavailable",
  invalid_line: "bad_model_output",
};

export function hintErrorNote(code: HintErrorCode): string {
  return HINT_ERROR_NOTES[code];
}

/**
 * The plain text Albert's column shows for a hint stream. An error replaces everything
 * streamed before it, so no partial hint text survives a failure.
 */
export function hintMarginText(events: readonly HintEvent[]): string {
  const error = events.find((event) => event.type === "error");
  if (error) return hintErrorNote(error.code);
  return events.flatMap((event) => event.type === "hint" ? [event.segments.map((segment) =>
    segment.type === "text" ? segment.text : segment.type === "math" ? segment.latex : "\n").join("")] : []).join("\n");
}
