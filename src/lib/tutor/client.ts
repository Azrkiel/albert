"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HintEventSchema, type HintEvent, type HintRequest } from "../contracts";
import { CLIENT_FAILURE_CODES, type ClientHintFailure } from "./error-notes";

export type HintStatus = "idle" | "streaming" | "done" | "error";
export type HintParserState = { buffer: string; events: HintEvent[]; status: HintStatus };

const failureMessages: Record<ClientHintFailure, string> = {
  http_400: "The hint route rejected the request.",
  http_error: "The hint route returned an error status.",
  network: "The hint request failed before it finished.",
  truncated: "The hint stream ended early.",
  invalid_line: "The hint stream had an invalid line.",
};

// The message is for logs only; the page shows the note for `code` (error-notes.ts).
function failed(state: HintParserState, failure: ClientHintFailure): HintParserState {
  return {
    buffer: "", status: "error",
    events: [...state.events, { type: "error", code: CLIENT_FAILURE_CODES[failure], message: failureMessages[failure] }],
  };
}

// Pure incremental parser: callers own decoding bytes and storing the next state.
export function parseHintChunk(state: HintParserState, chunk: string, final = false): HintParserState {
  if (state.status === "error") return state;
  const lines = (state.buffer + chunk).split("\n");
  const buffer = lines.pop()!;
  if (final && buffer.trim()) lines.push(buffer);
  let next: HintParserState = { ...state, buffer: final ? "" : buffer, events: [...state.events] };
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = HintEventSchema.parse(JSON.parse(line));
      next.events.push(event);
      if (event.type === "error") next.status = "error";
      else if (event.type === "done") next.status = "done";
      if (next.status === "error") return next;
    } catch {
      return failed(next, "invalid_line");
    }
  }
  if (final && next.status !== "done") next = failed(next, "truncated");
  return next;
}

export type HintFetch = (input: string, init: RequestInit) => Promise<Response>;
export type HintRunner = {
  request: (request: HintRequest) => Promise<void>;
  cancel: () => void;
  dispose: () => void;
};

/**
 * The request logic behind `useHint`, free of React so it can be unit tested (P3.8-AC2).
 * One stream at a time: a new request aborts the one in flight, and only the current
 * request may publish. A superseded request never publishes its events or its error.
 */
export function createHintRunner(fetchHint: HintFetch, publish: (state: HintParserState) => void): HintRunner {
  let active: AbortController | null = null;
  let latest: HintParserState = { buffer: "", events: [], status: "idle" };
  const show = (state: HintParserState) => { latest = state; publish(state); };

  const request = async (hintRequest: HintRequest) => {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    const current = () => active === controller && !controller.signal.aborted;
    let parsed: HintParserState = { buffer: "", events: [], status: "streaming" };
    show(parsed);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchHint("/api/hint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hintRequest), signal: controller.signal,
      });
      if (!current()) return;
      if (!response.ok || !response.body) {
        show(failed(parsed, response.status === 400 ? "http_400" : "http_error"));
        return;
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (!current()) break;
        parsed = parseHintChunk(parsed, done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
        show(parsed);
        if (done || parsed.status === "error") break;
      }
    } catch {
      if (current()) show(failed(parsed, "network"));
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      if (active === controller) active = null;
    }
  };

  const cancel = () => {
    active?.abort();
    active = null;
    show({ ...latest, status: "idle" });
  };
  // Never leave a stream "streaming" with no request behind it: the page would show "Getting a hint..." forever.
  const dispose = () => {
    const wasActive = active !== null;
    active?.abort();
    active = null;
    if (wasActive && latest.status === "streaming") show({ ...latest, status: "idle" });
  };
  return { request, cancel, dispose };
}

export function useHint() {
  const [state, setState] = useState<HintParserState>({ buffer: "", events: [], status: "idle" });
  // The whole page shares one runner, so a request on any problem cancels the one in flight.
  const runner = useMemo(() => createHintRunner((input, init) => fetch(input, init), setState), []);
  // Dispose only on a real unmount. Effects also re-run without one (Fast Refresh, Strict Mode); disposing
  // then aborted the hint in flight and the page kept "Getting a hint..." (the stuck.spec CI flake).
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(disposeTimer.current);
    return () => { disposeTimer.current = setTimeout(() => runner.dispose(), 0); };
  }, [runner]);
  return { events: state.events, status: state.status, requestHint: runner.request, cancel: runner.cancel };
}
