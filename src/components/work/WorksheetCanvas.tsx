"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SessionEvent, SessionRecording, Stroke } from "@/lib/contracts";
import { createSessionState, exportRecording, listClusters, parseRecording, reduceSessionEvent, Replayer, type SessionState } from "@/lib/canvas";
import { ClusterOverlay } from "./ClusterOverlay";
import { DevToolbar, type PlaybackSpeed } from "./DevToolbar";
import { ProblemBlock } from "./ProblemBlock";

declare global {
  interface Window { __albert?: { state: SessionState; replayDone: boolean } }
}

const devBuild = process.env.NODE_ENV !== "production";

export function WorksheetCanvas({ worksheetId, problems }: { worksheetId: string; problems: SessionRecording["problems"] }) {
  const params = useSearchParams();
  const fixture = devBuild ? params.get("replay") : null;
  const devTools = devBuild && params.get("dev") === "1";
  const urlSpeed = params.get("speed");
  const initialSpeed = urlSpeed === "instant" || urlSpeed === "4" ? urlSpeed : "1";
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [state, setState] = useState(() => createSessionState(problems, worksheetId));
  const current = useRef(state);
  const origin = useRef<number | null>(null);
  const player = useRef<Replayer | null>(null);
  const loaded = useRef<SessionRecording | null>(null);
  const loadId = useRef(0);
  const [revision, setRevision] = useState(0);
  const [replayDone, setReplayDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const getSessionStart = useCallback(() => origin.current ??= performance.now(), []);
  const replace = useCallback((next: SessionState) => { current.current = next; setState(next); }, []);
  const sink = useCallback((event: SessionEvent) => replace(reduceSessionEvent(current.current, event)), [replace]);
  const capture = useCallback((stroke: Stroke) => {
    // New live input takes ownership of the timeline; a pending replay cannot add old ink.
    player.current?.cancel();
    player.current = null;
    loaded.current = null;
    sink({ type: "stroke_end", at: stroke.t1, stroke });
  }, [sink]);

  const start = useCallback((rec: SessionRecording, playbackSpeed: PlaybackSpeed) => {
    player.current?.cancel();
    loaded.current = rec;
    setError("");
    setReplayDone(false);
    setRevision((value) => value + 1); // Discard in-flight pointer drafts on replacement.
    const reset = () => replace({ ...createSessionState(rec.problems, rec.worksheetId, rec.rows),
      durationMs: rec.durationMs, ...(rec.notes === undefined ? {} : { notes: rec.notes }) });
    reset();
    origin.current = performance.now() - rec.durationMs;
    const next = new Replayer(rec, sink, { speed: playbackSpeed === "4" ? 4 : 1, reset });
    player.current = next;
    const done = () => { if (player.current === next) setReplayDone(true); };
    if (playbackSpeed === "instant") { next.seek(rec.durationMs); done(); }
    else void next.play().then(done, () => { if (player.current === next) setError("Could not replay recording."); });
  }, [replace, sink]);

  useEffect(() => {
    if (!devBuild || !fixture) return;
    const controller = new AbortController();
    const id = ++loadId.current;
    void (async () => {
      try {
        const response = await fetch(`/api/dev/recording?name=${encodeURIComponent(fixture)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Fixture unavailable");
        const rec = parseRecording(await response.json());
        if (id === loadId.current) start(rec, initialSpeed);
      } catch {
        if (!controller.signal.aborted && id === loadId.current) setError("Could not load recording.");
      }
    })();
    return () => { controller.abort(); player.current?.cancel(); player.current = null; };
  }, [fixture, initialSpeed, start]);

  useEffect(() => () => { loadId.current++; player.current?.cancel(); player.current = null; }, []);
  useEffect(() => {
    if (!devBuild) return;
    window.__albert = { state, replayDone: replayDone && !loading };
    return () => { delete window.__albert; };
  }, [state, replayDone, loading]);

  async function load(file: File) {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const rec = parseRecording(JSON.parse(await file.text()));
      if (id === loadId.current) start(rec, speed);
    } catch { if (id === loadId.current) setError("Invalid recording. Choose a valid session JSON file."); }
    finally { if (id === loadId.current) setLoading(false); }
  }

  function snapshot() {
    return exportRecording({ ...current.current,
      durationMs: Math.max(current.current.durationMs, performance.now() - getSessionStart()) }, "session");
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "session.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <>
    {devTools && <DevToolbar speed={speed} onSpeed={setSpeed}
      onLoad={(file) => void load(file)} onExport={download} onPlay={() => start(loaded.current ?? snapshot(), speed)} />}
    {error && <p role="alert">{error}</p>}
    {state.problems.map((problem) => {
      const rows = state.rows.filter((row) => row.problemId === problem.id);
      return <ProblemBlock key={`${revision}/${problem.id}`} problem={problem} rows={rows}
        strokes={state.strokes.filter((stroke) => stroke.problemId === problem.id)}
        overlay={devTools ? <ClusterOverlay clusters={listClusters(state, rows.map((row) => row.id))} /> : undefined}
        getSessionStart={getSessionStart} onStroke={capture} />;
    })}
  </>;
}
