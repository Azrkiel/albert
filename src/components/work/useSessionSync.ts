"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSessionSync, type SessionSync } from "../../lib/canvas";
import { SessionSchema, SessionEventSchema, type Session, type SessionEvent } from "../../lib/contracts";
import { z } from "zod";

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

export type SessionSyncOptions = {
  resume?: boolean;
  fileId?: string;
  /** Restore locally; these historical events must not be pushed back through sync. */
  onRestore?: (session: Session, events: SessionEvent[]) => void;
};
const LatestReply = z.object({ session: SessionSchema.nullable(), events: z.array(SessionEventSchema) });

/** IO adapter shared by the hook and its offline lifecycle tests. */
export function createSessionConnection(worksheetId: string, options: SessionSyncOptions = {}, onReady?: (id: string) => void): Active {
  let sessionId: string | undefined;
  let creating: Promise<string> | undefined;
  const self: Active = { used: false, id: () => sessionId,
    ensure: () => sessionId !== undefined ? Promise.resolve(sessionId) : creating ??= (async () => {
      try {
        let restored: string | undefined;
        if (options.resume) {
          if (!options.fileId) throw new Error("PDF resume requires fileId");
          const query = new URLSearchParams({ worksheetId, fileId: options.fileId });
          const response = await fetch(`/api/session/latest?${query}`);
          if (!response.ok) throw new Error("Could not load saved session");
          const latest = LatestReply.parse(await response.json());
          if (latest.session) {
            if (latest.session.worksheetId !== worksheetId || latest.session.fileId !== options.fileId
              || latest.session.surface !== "pdf" || latest.session.endedAt !== undefined) throw new Error("Saved session does not match this page");
            options.onRestore?.(latest.session, latest.events);
            self.used = latest.events.length > 0;
            restored = latest.session.id;
          } else if (latest.events.length) throw new Error("Saved events have no session");
        }
        const id = restored ?? z.object({ sessionId: z.string().min(1) }).parse(await post("/api/session", {
          worksheetId, ...(options.fileId ? { surface: "pdf", fileId: options.fileId } : {}),
        })).sessionId;
        sessionId = id;
        onReady?.(id);
        return id;
      } catch (error) {
        creating = undefined;
        throw error;
      }
    })(),
    sync: createSessionSync(async events => { await post(`/api/session/${await self.ensure()}/events`, { events }); }),
  };
  return self;
}

/**
 * Owns the page's session: creates it on mount, buffers events, posts them every 3 s and on hide, and ends it.
 * Nothing here is awaited by drawing: `push` only appends to the in-memory buffer.
 */
export function useSessionSync(worksheetId: string, onSessionId: (id: string | undefined) => void, options: SessionSyncOptions = {}) {
  const active = useRef<Active | null>(null);
  const ended = useRef(false);
  const [status, setStatus] = useState<SyncStatus>("open");
  const [ready, setReady] = useState(!options.resume);
  const notify = useRef(onSessionId);
  const restore = useRef(options.onRestore);
  useEffect(() => { notify.current = onSessionId; restore.current = options.onRestore; }, [onSessionId, options.onRestore]);
  const { resume = false, fileId } = options;

  const open = useCallback((allowResume = true): Active => {
    const self = createSessionConnection(worksheetId, { resume: resume && allowResume, fileId, onRestore: (session, events) => restore.current?.(session, events) }, id => {
      if (active.current === self) { notify.current(id); setReady(true); setStatus("open"); }
    });
    return self;
  }, [worksheetId, resume, fileId]);

  const flush = useCallback(async () => {
    const ok = (await active.current?.sync.flush()) ?? true;
    if (!ok) setStatus("error");
    else if (active.current?.id()) setStatus(previous => previous === "error" ? "open" : previous);
    return ok;
  }, []);

  useEffect(() => {
    const current = active.current ??= open();
    void current.ensure().catch(() => { if (resume && active.current === current) setStatus("error"); });
    const timer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
    const hide = () => {
      if (document.visibilityState !== "hidden") return;
      const a = active.current;
      if (!a) return;
      const id = a.id();
      const beaconed = id !== undefined && typeof navigator.sendBeacon === "function" && a.sync.flushBeacon((events) =>
        navigator.sendBeacon(`/api/session/${id}/events`, new Blob([JSON.stringify({ events })], { type: "application/json" })));
      if (!beaconed) void flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void active.current?.sync.flush();
    };
  }, [open, resume, flush]);

  /** Buffers one event. After End session, the next event starts a fresh session. */
  const push = useCallback((event: SessionEvent) => {
    if (ended.current) {
      ended.current = false;
      active.current = open(false);
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
    const next = active.current = open(false);
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

  const retry = useCallback(async () => {
    try { await active.current?.ensure(); await flush(); }
    catch { setStatus("error"); }
  }, [flush]);
  return { push, restart, end, flush, status, ready, retry };
}
