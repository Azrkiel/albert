"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useSearchParams } from "next/navigation";
import type { CanvasLayout, HintRequest, Rung, SessionEvent, SessionRecording, Stroke, StuckSignal } from "@/lib/contracts";
import { useHint } from "@/lib/tutor/client";
import { hintMarginText } from "@/lib/tutor/error-notes";
import { mathToSvg, preloadInk, renderSegment, revealWipe } from "@/lib/ink";
import "@/lib/ink/ink.css";
import { buildHintRequest, clearRow, createSessionState, detectStuck, eraseGesture, exportRecording, historyEvent, isProblemSolved, listClusters, parseRecording, reduceSessionEvent, renderSnapshot, Replayer, type SessionState, type Snapshot } from "@/lib/canvas";
import { ClusterOverlay } from "./ClusterOverlay";
import { DevToolbar, type PlaybackSpeed } from "./DevToolbar";
import { ProblemBlock, type HintRequested } from "./ProblemBlock";
import { useSessionSync } from "./useSessionSync";

/** P2.7 dev hook: snapshot of the current state; problem and marked default to the row's problem and true. */
type SnapshotHook = (args: { upToRowId: string; problemId?: string; marked?: boolean }) => Promise<Snapshot>;
type HintRequestHook = (rowId: string, rung: Rung, trigger: StuckSignal["kind"]) => Promise<HintRequest>;

declare global {
  interface Window { __albert?: { state: SessionState; replayDone: boolean; renderSnapshot?: SnapshotHook; buildHintRequest?: HintRequestHook; sessionId?: string; flushSession?: () => Promise<boolean>;
    /** P4.2 dev hooks: MathJax loaded; typeset, render and reveal one segment. */
    mathReady?: boolean; mathToSvg?: typeof mathToSvg; renderSegment?: typeof renderSegment; revealWipe?: typeof revealWipe } }
}

/** The latest row of the problem written in last: what the dev Snapshot button shows. */
function latestRow(state: SessionState): string | null {
  const last = state.strokes.filter((s) => s.tool === "pen" && s.erasedAt === undefined).sort((a, b) => b.t1 - a.t1)[0];
  if (!last) return null;
  const inked = new Set(state.strokes.filter((s) => s.problemId === last.problemId && s.tool === "pen" && s.erasedAt === undefined).map((s) => s.rowId));
  return state.rows.filter((row) => inked.has(row.id)).sort((a, b) => b.index - a.index)[0]?.id ?? null;
}

const devBuild = process.env.NODE_ENV !== "production";
// Default ruled until P2.5a-AC4 passes on real handwriting; ?layout= overrides for checks and demos.
const envLayout: CanvasLayout = process.env.NEXT_PUBLIC_CANVAS_LAYOUT === "free" ? "free" : "ruled";

export type WorksheetCanvasHandle = { requestHint: (problemId: string, rowId: string, rung: Rung) => Promise<void> };

export function WorksheetCanvas({ worksheetId, problems, ref }: { worksheetId: string; problems: SessionRecording["problems"]; ref?: Ref<WorksheetCanvasHandle> }) {
  const params = useSearchParams();
  const fixture = devBuild ? params.get("replay") : null;
  const devTools = devBuild && params.get("dev") === "1";
  const urlLayout = params.get("layout");
  const layout: CanvasLayout = urlLayout === "free" || urlLayout === "ruled" ? urlLayout : envLayout;
  const autoHint = params.get("auto") === "1" || process.env.NEXT_PUBLIC_AUTO_HINT === "1";
  const urlSpeed = params.get("speed");
  const initialSpeed = urlSpeed === "instant" || urlSpeed === "4" ? urlSpeed : "1";
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [state, setState] = useState(() => createSessionState(problems, worksheetId, undefined, layout));
  const [tool, setTool] = useState<Stroke["tool"]>("pen");
  const current = useRef(state);
  const origin = useRef<number | null>(null);
  const player = useRef<Replayer | null>(null);
  const loaded = useRef<SessionRecording | null>(null);
  const replayClock = useRef<{ started: number; speed: number; duration: number; instant: boolean } | null>(null);
  const seeking = useRef(false);
  const markVisibleSince = useRef(new WeakMap<StuckSignal, number>());
  const loadId = useRef(0);
  const [revision, setRevision] = useState(0);
  const [replayDone, setReplayDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // P2.8: the store's session id once POST /api/session has answered; the local id until then.
  const fallbackSessionId = useId();
  const [serverSessionId, setServerSessionId] = useState<string>();
  const sessionId = serverSessionId ?? fallbackSessionId;
  const sync = useSessionSync(worksheetId, setServerSessionId);
  const { push: syncPush, restart: syncRestart } = sync;
  const hint = useHint();
  const [hintTarget, setHintTarget] = useState<{ problemId: string; rowId: string } | null>(null);
  const sendHint = hint.requestHint;
  const getSessionStart = useCallback(() => origin.current ??= performance.now(), []);
  const now = useCallback(() => {
    const replay = replayClock.current;
    return replay ? replay.instant ? replay.duration : Math.min(replay.duration, (performance.now() - replay.started) * replay.speed)
      : Math.max(current.current.durationMs, performance.now() - getSessionStart());
  }, [getSessionStart]);
  const replace = useCallback((next: SessionState) => { current.current = next; setState(next); }, []);
  const detect = useCallback((at: number) => {
    const s = current.current;
    const signal = detectStuck(s.events, at, s.rows, listClusters(s));
    if (signal) {
      const event: SessionEvent = { type: "stuck", at, signal };
      replace(reduceSessionEvent(s, event));
      syncPush(event);
    }
  }, [replace, syncPush]);
  const sink = useCallback((event: SessionEvent) => {
    replace(reduceSessionEvent(current.current, event));
    syncPush(event);
    if (!seeking.current) detect(event.at);
  }, [replace, detect, syncPush]);
  // P2.6 can call this same entry point through the canvas ref. P2.7 will
  // replace the placeholder PNG and empty cluster lists with a real snapshot.
  const requestHint = useCallback(async (problemId: string, rowId: string, rung: Rung, trigger: StuckSignal["kind"] = "manual") => {
    sink({ type: "hint_requested", at: now(), hintId: `hint-${sessionId}-${current.current.events.length}`, rowId, rung });
    setHintTarget({ problemId, rowId });
    await sendHint({ sessionId, worksheetId: current.current.worksheetId, problemId, rowId, rung, trigger,
      image: { marked: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", width: 1, height: 1 },
      rows: current.current.rows.filter((row) => row.problemId === problemId).map((row) => ({ rowId: row.id, index: row.index, clusterLabels: [] })), history: [] });
  }, [sendHint, sessionId, sink, now]);
  useImperativeHandle(ref, () => ({ requestHint }), [requestHint]);
  // P3.8: an error shows only its plain note; partial hint text before it is dropped.
  const hintText = hintMarginText(hint.events) || (hint.status === "streaming" ? "Getting a hint..." : "");
  const liveEvents = useCallback((events: SessionEvent[]) => {
    if (!events.length) return;
    // New live input takes ownership of the timeline; a pending replay cannot add old ink.
    player.current?.cancel();
    player.current = null;
    loaded.current = null;
    replayClock.current = null;
    loadId.current++;
    setLoading(false);
    for (const event of events) sink(event);
  }, [sink]);
  const capture = useCallback((stroke: Stroke) => {
    liveEvents(stroke.tool === "eraser" ? eraseGesture(current.current, stroke.problemId, stroke.points, stroke.t1)
      : [{ type: "stroke_end", at: stroke.t1, stroke }]);
  }, [liveEvents]);
  const history = useCallback((direction: "undo" | "redo") => {
    const at = Math.max(current.current.durationMs, performance.now() - getSessionStart());
    const event = historyEvent(current.current, direction, at);
    if (event) liveEvents([event]);
  }, [getSessionStart, liveEvents]);

  const onHintRequested = useCallback((problemId: string, request: HintRequested) => {
    if (isProblemSolved(current.current.events, problemId)) return;
    if (request.trigger === "manual") {
      const signal: StuckSignal = { kind: "manual", problemId, rowId: request.rowId, at: now() };
      sink({ type: "stuck", at: signal.at, signal });
    }
    void requestHint(problemId, request.rowId, request.rung, request.trigger);
  }, [now, requestHint, sink]);

  useEffect(() => {
    const timer = setInterval(() => { if (!seeking.current) detect(now()); }, 1000);
    return () => clearInterval(timer);
  }, [detect, now]);

  useEffect(() => {
    if (!autoHint) return;
    const timers = Object.values(state.stuckMarks).filter((mark) => mark.kind === "pause").map((mark) => {
      const appeared = markVisibleSince.current.get(mark) ?? performance.now();
      markVisibleSince.current.set(mark, appeared);
      return setTimeout(() => {
        if (current.current.stuckMarks[mark.problemId] === mark) {
          onHintRequested(mark.problemId, { rowId: mark.rowId, rung: 1, trigger: "pause" });
        }
      }, Math.max(0, 1500 - (performance.now() - appeared)));
    });
    return () => timers.forEach(clearTimeout);
  }, [autoHint, state.stuckMarks, onHintRequested]);
  const clear = useCallback((rowId: string) => {
    const at = Math.max(current.current.durationMs, performance.now() - getSessionStart());
    const event = clearRow(current.current, rowId, at);
    if (event) liveEvents([event]);
  }, [getSessionStart, liveEvents]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      event.preventDefault();
      history(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [history]);

  const start = useCallback((rec: SessionRecording, playbackSpeed: PlaybackSpeed) => {
    player.current?.cancel();
    loaded.current = rec;
    setError("");
    setReplayDone(false);
    setRevision((value) => value + 1); // Discard in-flight pointer drafts on replacement.
    const reset = () => { syncRestart(); replace({ ...createSessionState(rec.problems, rec.worksheetId, rec.rows, rec.layout ?? "ruled"),
      durationMs: rec.durationMs, ...(rec.notes === undefined ? {} : { notes: rec.notes }) }); };
    reset();
    origin.current = performance.now() - rec.durationMs;
    replayClock.current = { started: performance.now(), speed: playbackSpeed === "4" ? 4 : 1,
      duration: rec.durationMs, instant: playbackSpeed === "instant" };
    const next = new Replayer(rec, sink, { speed: playbackSpeed === "4" ? 4 : 1, reset });
    player.current = next;
    const done = () => {
      if (player.current !== next) return;
      origin.current = performance.now() - rec.durationMs;
      replayClock.current = null;
      detect(rec.durationMs); // Include the recording's trailing pause without waiting in wall time.
      setReplayDone(true);
    };
    if (playbackSpeed === "instant") {
      seeking.current = true;
      try { next.seek(rec.durationMs); } finally { seeking.current = false; }
      done();
    }
    else void next.play().then(done, () => { if (player.current === next) setError("Could not replay recording."); });
  }, [replace, sink, detect, syncRestart]);

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
  const snapshotHook = useCallback<SnapshotHook>(({ upToRowId, problemId, marked = true }) => {
    const state = current.current;
    const row = state.rows.find((r) => r.id === upToRowId);
    return renderSnapshot({ strokes: state.strokes, rows: state.rows, clusters: listClusters(state),
      problemId: problemId ?? row?.problemId ?? "", upToRowId, marked });
  }, []);
  const hintRequestHook = useCallback<HintRequestHook>((rowId, rung, trigger) =>
    buildHintRequest(current.current, rowId, rung, trigger, { sessionId }), [sessionId]);
  // P4.2: load the hand font and MathJax when the work page mounts, before the first hint.
  const [mathReady, setMathReady] = useState(false);
  useEffect(() => {
    let live = true;
    void preloadInk().then((ready) => { if (live) setMathReady(ready); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!devBuild) return;
    window.__albert = { state, replayDone: replayDone && !loading, renderSnapshot: snapshotHook, buildHintRequest: hintRequestHook,
      ...(serverSessionId === undefined ? {} : { sessionId: serverSessionId }), flushSession: sync.flush,
      mathReady, mathToSvg, renderSegment, revealWipe };
    return () => { delete window.__albert; };
  }, [state, replayDone, loading, snapshotHook, hintRequestHook, serverSessionId, sync.flush, mathReady]);

  function openSnapshot() {
    const rowId = latestRow(current.current);
    if (!rowId) { setError("Nothing written yet."); return; }
    // Open the tab inside the click so it is not blocked, then point it at the image.
    const tab = window.open("", "_blank");
    void snapshotHook({ upToRowId: rowId }).then(({ png }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      if (tab) tab.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, () => { tab?.close(); setError("Could not render snapshot."); });
  }

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
    <div role="group" aria-label="Ink tools" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
      <button type="button" aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>Pen</button>
      <button type="button" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>Eraser</button>
      <button type="button" disabled={!state.undoStack.length} onClick={() => history("undo")}>Undo</button>
      <button type="button" disabled={!state.redoStack.length} onClick={() => history("redo")}>Redo</button>
      <button type="button" disabled={sync.status === "ending" || sync.status === "ended"} onClick={() => void sync.end()}>End session</button>
    </div>
    {devTools && <DevToolbar speed={speed} onSpeed={setSpeed}
      onLoad={(file) => void load(file)} onExport={download} onPlay={() => start(loaded.current ?? snapshot(), speed)}
      onSnapshot={openSnapshot} />}
    {devTools && state.problems[0] && <button type="button"
      disabled={hint.status === "streaming"}
      onClick={() => {
        const problem = state.problems[0];
        if (problem) void requestHint(problem.id, `${problem.id}/r3`, 1);
      }}>Request mock hint</button>}
    {sync.status === "ended" && <p role="status">Session ended. Your work is saved.</p>}
    {sync.status === "error" && <p role="alert">Could not save your session. Check your connection and try again.</p>}
    {error && <p role="alert">{error}</p>}
    {state.problems.map((problem) => {
      const rows = state.rows.filter((row) => row.problemId === problem.id);
      return <ProblemBlock key={`${revision}/${problem.id}`} problem={problem} rows={rows}
        strokes={state.strokes.filter((stroke) => stroke.problemId === problem.id)}
        hintText={hintTarget?.problemId === problem.id ? hintText : undefined}
        hintRowId={hintTarget?.problemId === problem.id ? hintTarget.rowId : undefined}
        stuckMark={state.stuckMarks[problem.id]}
        hintDisabled={hint.status === "streaming" || isProblemSolved(state.events, problem.id)}
        onHintRequested={(request) => onHintRequested(problem.id, request)}
        getSessionStart={getSessionStart} onStroke={capture} tool={tool} onClearRow={clear} layout={state.layout}
        devOverlay={devTools ? <ClusterOverlay clusters={listClusters(state, rows.map((row) => row.id))}
          lines={state.layout === "free" ? rows : undefined} /> : undefined} />;
    })}
  </>;
}
