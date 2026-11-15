"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { AgentEvent } from "../../lib/contracts";
import { elapsedLabel, eventLabel, parseSse, todoProgress } from "./learn-progress";
import styles from "./source.module.css";

const contextSchema = z.object({ cards: z.number().int().nonnegative(), worksheets: z.array(z.object({ id: z.string(), title: z.string() })) });
type Context = z.infer<typeof contextSchema>;
type Phase = "idle" | "learning" | "ready" | "failed";

async function loadContext(courseId: string, signal?: AbortSignal): Promise<Context | null> {
  try {
    const response = await fetch(`/api/agent/context?courseId=${encodeURIComponent(courseId)}`, { cache: "no-store", ...(signal ? { signal } : {}) });
    if (!response.ok) return null;
    const parsed = contextSchema.safeParse(await response.json());
    return parsed.success && parsed.data.cards > 0 ? parsed.data : null;
  } catch { return null; }
}

/** Learn this course: starts or joins the ingest run and shows its progress. A failure keeps the last ready context visible. */
export function LearnPanel({ courseId, ingested }: { courseId: string; ingested: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [context, setContext] = useState<Context | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const mounted = useRef(true);
  const running = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    if (ingested) void loadContext(courseId, controller.signal).then(found => {
      if (found && mounted.current) { setContext(found); setPhase(p => p === "idle" ? "ready" : p); }
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [courseId, ingested]);

  useEffect(() => {
    if (phase !== "learning") return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const learn = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const started = Date.now();
    setStartedAt(started); setNow(started); setEvents([]); setPhase("learning");
    let finished: "done" | "failed" = "failed";
    try {
      const response = await fetch("/api/agent/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      if (!response.ok || !response.body) throw new Error("The run did not start.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        const parsed = parseSse(buffer);
        buffer = parsed.rest;
        if (!parsed.events.length) continue;
        if (mounted.current) setEvents(previous => [...previous, ...parsed.events]);
        for (const event of parsed.events) {
          if (event.type === "error") finished = "failed";
          else if (event.type === "note" && event.label === "done") finished = "done";
        }
      }
    } catch { finished = "failed"; }
    running.current = false;
    if (!mounted.current) return;
    if (finished === "done") {
      const found = await loadContext(courseId);
      if (!mounted.current) return;
      if (found) { setContext(found); setPhase("ready"); } else setPhase("failed");
    } else setPhase("failed");
  }, [courseId]);

  const latest = events.at(-1);
  const progress = todoProgress(events);
  return (
    <div className={styles.learn} data-phase={phase}>
      {phase === "learning" ? (
        <div role="status" aria-live="polite">
          <button className={styles.action} type="button" disabled>Learning…</button>
          <p>{progress ? `${progress.done} of ${progress.total} steps` : "Starting"} · {elapsedLabel(now - startedAt)}</p>
          {latest ? <p>{eventLabel(latest)}</p> : null}
        </div>
      ) : (
        <>
          {phase === "failed" ? <p role="alert">Learning this course failed. Try again.</p> : null}
          <button className={styles.action} type="button" onClick={() => void learn()}>
            {phase === "failed" ? "Try again" : phase === "ready" || ingested ? "Learn again" : "Learn this course"}
          </button>
        </>
      )}
      {context && phase !== "learning" ? (
        <section aria-label="Course context">
          <p>{context.cards} {context.cards === 1 ? "card" : "cards"} · {context.worksheets.length} {context.worksheets.length === 1 ? "worksheet" : "worksheets"}</p>
          <ul className={styles.worksheets}>
            {context.worksheets.map(w => (
              <li key={w.id}>
                <span>{w.title}</span>{" "}
                <Link href={`/work/${encodeURIComponent(w.id)}`} aria-label={`Open ${w.title}`}>Open</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
