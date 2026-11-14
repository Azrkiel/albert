"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HintEventSchema, type HintEvent, type HintRequest } from "../contracts";

export type HintStatus = "idle" | "streaming" | "done" | "error";
export type HintParserState = { buffer: string; events: HintEvent[]; status: HintStatus };

function failed(state: HintParserState, message: string): HintParserState {
  return { buffer: "", events: [...state.events, { type: "error", code: "bad_model_output", message }], status: "error" };
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
      return failed(next, "Albert returned an invalid hint stream.");
    }
  }
  if (final && next.status !== "done") next = failed(next, "Albert's hint stream ended early.");
  return next;
}

export function useHint() {
  const [state, setState] = useState<HintParserState>({ buffer: "", events: [], status: "idle" });
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setState((previous) => ({ ...previous, status: "idle" }));
  }, []);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const requestHint = useCallback(async (request: HintRequest) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    let parsed: HintParserState = { buffer: "", events: [], status: "streaming" };
    setState(parsed);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch("/api/hint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request), signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Hint request failed.");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (active.current !== controller) break;
        parsed = parseHintChunk(parsed, done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
        setState(parsed);
        if (done || parsed.status === "error") break;
      }
    } catch {
      if (active.current === controller && !controller.signal.aborted) {
        setState(failed(parsed, "Albert could not finish this hint. Try again."));
      }
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      if (active.current === controller) active.current = null;
    }
  }, []);
  return { events: state.events, status: state.status, requestHint, cancel };
}
