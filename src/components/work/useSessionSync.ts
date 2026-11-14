"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSessionSync, type SessionSync } from "@/lib/canvas";
import type { SessionEvent } from "@/lib/contracts";

/** How often buffered events are posted (P2.8). */
export const FLUSH_INTERVAL_MS = 3000;

export type SyncStatus = "open" | "ending" | "ended" | "error";

type Active = {
  sync: SessionSync;
  /** Resolves with the session id, creating the session on the first call (and again after a failed attempt). */
  ensure: () => Promise<string>;
  id: () => string | undefined;
  used: boolean;
};

async function post(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.json();
}

/**
 * Owns the page's session: creates it on mount, buffers events, posts them every 3 s and on hide, and ends it.
 * Nothing here is awaited by drawing: `push` only appends to the in-memory buffer.
 */
export function useSessionSync(worksheetId: string, onSessionId: (id: string | undefined) => void) {
  const active = useRef<Active | null>(null);
  const ended = useRef(false);
  const [status, setStatus] = useState<SyncStatus>("open");
  const notify = useRef(onSessionId);
  useEffect(() => { notify.current = onSessionId; }, [onSessionId]);

  const open = useCallback((): Active => {
    let sessionId: string | undefined;
    let creating: Promise<string> | undefined;
    const self: Active = { used: false, id: () => sessionId,
      ensure: () => sessionId !== undefined ? Promise.resolve(sessionId) : creating ??= (async () => {
        try {
          const reply = await post("/api/session", { worksheetId });
          const id = typeof reply === "object" && reply !== null && "sessionId" in reply ? reply.sessionId : undefined;
          if (typeof id !== "string") throw new Error("Bad session reply");
          sessionId = id;
          if (active.current === self) notify.current(id);
          return id;
        } catch (error) {
          creating = undefined;
          throw error;
        }
      })(),
      sync: createSessionSync(async (events) => {
        await post(`/api/session/${await self.ensure()}/events`, { events });
      }) };
    return self;
  }, [worksheetId]);

  useEffect(() => {
    const current = active.current ??= open();
    void current.ensure().catch(() => {}); // A failed start is retried by the next flush.
    const timer = setInterval(() => { void active.current?.sync.flush(); }, FLUSH_INTERVAL_MS);
    const hide = () => {
      if (document.visibilityState !== "hidden") return;
      const a = active.current;
      if (!a) return;
      const id = a.id();
      const beaconed = id !== undefined && typeof navigator.sendBeacon === "function" && a.sync.flushBeacon((events) =>
        navigator.sendBeacon(`/api/session/${id}/events`, new Blob([JSON.stringify({ events })], { type: "application/json" })));
      if (!beaconed) void a.sync.flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void active.current?.sync.flush();
    };
  }, [open]);

  /** Buffers one event. After End session, the next event starts a fresh session. */
  const push = useCallback((event: SessionEvent) => {
    if (ended.current) {
      ended.current = false;
      active.current = open();
      notify.current(undefined);
      setStatus("open");
    }
    const a = active.current ??= open();
    a.used = true;
    a.sync.push(event);
  }, [open]);

  /** A replay replaces the page's history, so it gets its own session; an untouched session is reused. */
  const restart = useCallback(() => {
    const old = active.current;
    if (!old?.used) return;
    void old.sync.flush();
    const next = active.current = open();
    notify.current(undefined);
    void next.ensure().catch(() => {});
  }, [open]);

  const end = useCallback(async () => {
    const a = active.current;
    if (!a || ended.current) return;
    setStatus("ending");
    try {
      const id = await a.ensure();
      if (!await a.sync.flush()) throw new Error("Events not saved");
      await post(`/api/session/${id}/end`);
      ended.current = true;
      setStatus("ended");
    } catch {
      setStatus("error");
    }
  }, []);

  const flush = useCallback(async () => (await active.current?.sync.flush()) ?? true, []);
  return { push, restart, end, flush, status };
}
