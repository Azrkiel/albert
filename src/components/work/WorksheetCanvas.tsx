"use client";

import { mergeRestoredEvents } from "@/lib/canvas/session-restore";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { useSearchParams } from "next/navigation";
import type { AlbertMark, CanvasLayout, HintEvent, HintRequest, Rung, SessionEvent, SessionRecording, Stroke, StuckSignal, Worksheet } from "@/lib/contracts";
import { useHint } from "@/lib/tutor/client";
import { hintMarginText } from "@/lib/tutor/error-notes";
import { createConductor, mathToSvg, preloadInk, renderSegment, revealWipe, type HintContext } from "@/lib/ink";
import "@/lib/ink/ink.css";
import { buildHintRequest, clearRow, createSessionState, detectStuck, eraseGesture, exportRecording, historyEvent, isProblemSolved, listClusters, parseRecording, reduceSessionEvent, renderSnapshot, Replayer, type SessionState, type Snapshot } from "@/lib/canvas";
import { AlbertControls, AlbertLayer, ReadingTip } from "./AlbertLayer";
import { ClusterOverlay } from "./ClusterOverlay";
import { DevToolbar, type PlaybackSpeed } from "./DevToolbar";
import { ProblemBlock, type HintRequested } from "./ProblemBlock";
import { PdfPageBlock } from "./PdfPageBlock";
import { pageHeight, type PdfPage } from "@/lib/canvas";
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

export type WorksheetCanvasHandle = { requestHint: (problemId: string, rowId: string, rung: Rung) => Promise<void>;
  /** P3.7: fade all of a problem's Albert notes (a `correct` check). */
  fadeAlbertNotes: (problemId: string) => void;
  /** Remove all of a problem's Albert notes. */
  clearAlbertNotes: (problemId: string) => void };

export function WorksheetCanvas({ worksheetId, worksheetTitle, problems, fileId, pdfProblems = [], problemSource = "worksheet", ref }: { worksheetId: string; worksheetTitle?: string; fileId?: string; pdfProblems?: Worksheet["problems"]; problemSource?: HintRequest["problemSource"]; problems: SessionRecording["problems"]; ref?: Ref<WorksheetCanvasHandle> }) {
  const params = useSearchParams();
  const fixture = devBuild ? params.get("replay") : null;
  const devTools = devBuild && params.get("dev") === "1";
  const urlLayout = params.get("layout");
  const surface = params.get("surface");
  const pdf = !!fileId && !fixture && surface !== "ruled" && surface !== "free" && urlLayout !== "ruled" && urlLayout !== "free";
  const layout: CanvasLayout = pdf || surface === "free" ? "free" : surface === "ruled" ? "ruled" : urlLayout === "free" || urlLayout === "ruled" ? urlLayout : envLayout;
  const autoHint = params.get("auto") === "1" || process.env.NEXT_PUBLIC_AUTO_HINT === "1";
  const urlSpeed = params.get("speed");
  const initialSpeed = urlSpeed === "instant" || urlSpeed === "4" ? urlSpeed : "1";
  const [speed, setSpeed] = useState<PlaybackSpeed>(initialSpeed);
  const [state, setState] = useState(() => ({ ...createSessionState(problems, worksheetId, undefined, layout), ...(pdf ? { surface: "pdf" as const, fileId } : {}) }));
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [pageError, setPageError] = useState("");
  const [activePage, setActivePage] = useState(1);
  const pagesRef = useRef(pages);
  useEffect(() => {
    if (state.surface !== "pdf" || !state.fileId) return;
    const abort = new AbortController();
    void fetch(`/api/files/${encodeURIComponent(state.fileId)}/pages`, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error("Pages unavailable");
      const value: unknown = await response.json();
      if (!Array.isArray(value) || !value.length || !value.every(p => p && Number.isInteger(p.page) && p.page > 0
        && Number.isFinite(p.widthPt) && p.widthPt > 0 && Number.isFinite(p.heightPt) && p.heightPt > 0)) throw new Error("Invalid pages");
      if (!abort.signal.aborted) {
        // Replay can queue during layer attachment, before passive effects run.
        pagesRef.current = value as PdfPage[];
        setPages(value as PdfPage[]); setPageError("");
      }
    }).catch(() => { if (!abort.signal.aborted) setPageError("Could not open the PDF pages. Reload to try again."); });
    return () => abort.abort();
  }, [state.surface, state.fileId]);
  const [tool, setTool] = useState<Stroke["tool"]>("pen");
  const current = useRef(state);
  const [savingPdf, setSavingPdf] = useState(false);
  const origin = useRef<number | null>(null);
  const player = useRef<Replayer | null>(null);
  const loaded = useRef<SessionRecording | null>(null);
  const replayClock = useRef<{ started: number; speed: number; duration: number; instant: boolean } | null>(null);
  const seeking = useRef(false);
  const markVisibleSince = useRef(new WeakMap<StuckSignal, number>());
  const loadId = useRef(0);
  const hintRequestId = useRef(0);
  const [revision, setRevision] = useState(0);
  const [replayDone, setReplayDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pdfEnding, setPdfEnding] = useState(false);
  const [pdfEndRequested, setPdfEndRequested] = useState(false);
  const pdfLocked = useRef(false);
  const drainingHint = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const restoredHints = useRef<Extract<SessionEvent, { type: "hint_shown" }>[]>([]);
  // P2.8: the store's session id once POST /api/session has answered; the local id until then.
  const fallbackSessionId = useId();
  const [serverSessionId, setServerSessionId] = useState<string>();
  const sessionId = serverSessionId ?? fallbackSessionId;
  const sync = useSessionSync(worksheetId, setServerSessionId, {
    resume: pdf,
    fileId: pdf ? fileId : undefined,
    onRestore: (session, events) => {
      const restored = mergeRestoredEvents({ ...createSessionState(problems, worksheetId, undefined, "free"), surface: "pdf", fileId: session.fileId }, events);
      origin.current = performance.now() - Math.max(restored.durationMs, ...restored.strokes.map(stroke => stroke.t1));
      restoredHints.current = events.filter((event): event is Extract<SessionEvent, { type: "hint_shown" }> => event.type === "hint_shown");
      current.current = restored;
      setState(restored);
    },
  });
  const { push: syncPush, restart: syncRestart } = sync;
  const hint = useHint();
  const pdfInputLocked = state.surface === "pdf" && (!sync.ready || pdfEnding
    || (pdfEndRequested && (sync.status === "ending" || sync.status === "ended")));
  useEffect(() => { pdfLocked.current = pdfInputLocked; }, [pdfInputLocked]);
  const [hintTarget, setHintTarget] = useState<{ problemId: string; rowId: string } | null>(null);
  const sendHint = hint.requestHint;
  const cancelHint = hint.cancel;
  const pendingHint = useRef<{ hintId: string; shown: boolean } | null>(null);
  const [preparingHint, setPreparingHint] = useState(false);
  const getSessionStart = useCallback(() => origin.current ??= performance.now(), []);
  const now = useCallback(() => {
    const replay = replayClock.current;
    return replay ? replay.instant ? replay.duration : Math.min(replay.duration, (performance.now() - replay.started) * replay.speed)
      : Math.max(current.current.durationMs, performance.now() - getSessionStart());
  }, [getSessionStart]);
  const replace = useCallback((next: SessionState) => { current.current = next; setState(next); }, []);
  // P4.3: Albert's ink. The conductor draws into each problem's AlbertLayer; `feed` says which events it has seen.
  const nowRef = useRef(now);
  const shownRef = useRef<(ctx: HintContext, marks: AlbertMark[]) => void>(() => {});
  useEffect(() => { nowRef.current = now; }, [now]);
  // The host only reads the refs later, when events arrive; nothing is read during render.
  // eslint-disable-next-line react-hooks/refs
  const [conductor] = useState(() => createConductor({
    geometry: () => ({ rows: current.current.rows, clusters: listClusters(current.current) }),
    pageMode: () => current.current.surface === "pdf",
    noteLabel: problemId => current.current.surface === "pdf" ? `Problem ${current.current.problems.find(problem => problem.id === problemId)?.label ?? ""}` : undefined,
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    narrow: () => window.matchMedia("(max-width: 899px)").matches,
    pageHeight: page => { const size = pagesRef.current.find(p => p.page === page); return size ? pageHeight(size) : 0; },
    now: () => nowRef.current(),
    onShown: (ctx, marks) => shownRef.current(ctx, marks),
  }));
  useEffect(() => {
    if (!sync.ready || !pages.length || !restoredHints.current.length) return;
    // Child layers attach during commit. Historical hints redraw instantly without entering the live sink.
    const saved = restoredHints.current;
    restoredHints.current = [];
    for (const event of saved) {
      const requested = current.current.events.find(item => item.type === "hint_requested" && item.hintId === event.hintId);
      conductor.replayShown(event.marks, { instant: true, rung: requested?.type === "hint_requested" ? requested.rung : 1 });
    }
  }, [sync.ready, pages, state, conductor]);
  // `first` identifies a stream (each request parses into new event objects); its context comes from the
  // latest hint_requested event, so the request/snapshot code path is not touched.
  useSyncExternalStore(conductor.subscribe, conductor.version, conductor.version); // re-render when Albert's ink changes a surface's size
  const feed = useRef<{ first: HintEvent | undefined; ctx: HintContext | null; n: number }>({ first: undefined, ctx: null, n: 0 });
  const detect = useCallback((at: number) => {
    const s = current.current;
    if (s.surface === "pdf" && pdfLocked.current) return;
    const signal = detectStuck(s.events, at, s.rows, listClusters(s));
    if (signal) {
      const event: SessionEvent = { type: "stuck", at, signal };
      replace(reduceSessionEvent(s, event));
      syncPush(event);
    }
  }, [replace, syncPush]);
  const sink = useCallback((event: SessionEvent) => {
    if (current.current.surface === "pdf" && pdfLocked.current && !(drainingHint.current && event.type === "hint_shown")) return;
    const next = reduceSessionEvent(current.current, event);
    if (next === current.current) return;
    replace(next);
    syncPush(next.events.at(-1)!);
    // P4.6: a recording's hint redraws its marks (a live one is already on the page and is skipped).
    if (event.type === "hint_shown") {
      const rung = current.current.events.find((e) => e.type === "hint_requested" && e.hintId === event.hintId);
      conductor.replayShown(event.marks, { instant: seeking.current || replayClock.current?.instant === true,
        rung: rung?.type === "hint_requested" ? rung.rung : 1 });
    }
    if (!seeking.current) detect(event.at);
    }, [replace, detect, syncPush, conductor]);
  const backgroundFor = useCallback((rowId: string) => {
    const s = current.current;
    const row = s.rows.find(r => r.id === rowId);
    const page = pagesRef.current.find(p => p.page === row?.page);
    if (s.surface !== "pdf" || !page || !s.fileId) return undefined;
    const region = pdfProblems.find(p => p.id === row?.problemId)?.region;
    return { src: `/api/files/${encodeURIComponent(s.fileId)}/page/${page.page}`, page: page.page,
      width: 1200, height: pageHeight(page), crop: region?.page === page.page ? region.bbox : { x: 0, y: 0, w: 1200, h: pageHeight(page) } };
  }, [pdfProblems]);
  // Manual, stuck-mark and ref requests share the real P2.7 snapshot builder
  const requestHint = useCallback(async (problemId: string, rowId: string, rung: Rung, trigger: StuckSignal["kind"] = "manual", question?: string, page?: number) => {
    if (isProblemSolved(current.current.events, problemId)) return;
    if (current.current.surface === "pdf" && pdfLocked.current) return;
    const id = ++hintRequestId.current;
    cancelHint();
    if (pendingHint.current && !pendingHint.current.shown) conductor.cancel(pendingHint.current.hintId);
    setError(""); setPreparingHint(true);
    const hintId = `hint-${sessionId}-${current.current.events.length}`;
    pendingHint.current = { hintId, shown: false };
    const targetPage = page ?? current.current.rows.find(r => r.id === rowId)?.page;
    sink({ type: "hint_requested", at: now(), hintId, rowId, rung,
      ...(question === undefined ? {} : { question, problemId, ...(targetPage === undefined ? {} : { page: targetPage }) }) });
    setHintTarget({ problemId, rowId });
    try {
      const request = await buildHintRequest(
        current.current,
        rowId,
        rung,
        trigger,
        { sessionId, problemSource, background: backgroundFor(rowId), ...(question === undefined ? {} : { question }) },
      );
      // A slower snapshot from an older click must not replace a newer request.
      if (id === hintRequestId.current) { setPreparingHint(false); await sendHint(request); }
    } catch {
      if (id === hintRequestId.current) {
        setError("Could not prepare your writing for a hint. Try again.");
      }
    } finally { if (id === hintRequestId.current) setPreparingHint(false); }
  }, [sendHint, cancelHint, conductor, sessionId, sink, now, problemSource, backgroundFor]);

  useImperativeHandle(ref, () => ({
    requestHint,
    fadeAlbertNotes: (problemId) => conductor.fadeProblem(problemId),
    clearAlbertNotes: (problemId) => conductor.clearProblem(problemId),
  }), [requestHint, conductor]);

  // A finished hint is part of the session: its drawn marks go in as a hint_shown event (replayed in P4.6).
  useEffect(() => {
    shownRef.current = (ctx, marks) => {
      if (pendingHint.current?.hintId === ctx.hintId) pendingHint.current.shown = true;
      sink({
      type: "hint_shown",
      at: now(),
      hintId: ctx.hintId,
      marks,
      });
    };
  }, [sink, now]);

  useEffect(() => {
    const f = feed.current;
    const events = hint.events;
    if (!events.length) return;

    if (events[0] !== f.first) {
      const requested = current.current.events.findLast(
        (e) => e.type === "hint_requested",
      );
      const problemId = requested && current.current.rows.find(
        (row) => row.id === requested.rowId,
      )?.problemId;

      f.first = events[0];
      f.n = 0;
      f.ctx = requested && problemId ? {
        hintId: requested.hintId,
        seedId: requested.hintId,
        problemId,
        rowId: requested.rowId,
        rung: requested.rung,
      } : null;
    }

    while (f.n < events.length) {
      const event = events[f.n++]!;
      if (f.ctx) conductor.handle(f.ctx, event);
    }
  }, [hint.events, conductor]);
  // P3.8: an error shows only its plain note; partial hint text before it is dropped.
  // The writing is drawn as ink once a hint event is in and no error followed; until then the plain text shows.
  const hintInk = !preparingHint && hint.events.some((event) => event.type === "hint") && !hint.events.some((event) => event.type === "error");
  const hintText = preparingHint ? "Getting a hint..." : hintMarginText(hint.events) || (hint.status === "streaming" ? "Getting a hint..." : "");
  const liveEvents = useCallback((events: SessionEvent[]) => {
    if (current.current.surface === "pdf" && pdfLocked.current) return;
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
    liveEvents(stroke.tool === "eraser" ? eraseGesture(current.current, stroke.problemId, stroke.points, stroke.t1, stroke.page)
      : [{ type: "stroke_end", at: stroke.t1, stroke }]);
    // New writing in a row Albert pointed at fades that hint (P4.4).
    const rowId = current.current.strokes.find((s) => s.id === stroke.id)?.rowId;
    if (stroke.tool === "pen" && rowId) conductor.inkAdded(stroke.problemId, rowId);
  }, [liveEvents, conductor]);
  const history = useCallback((direction: "undo" | "redo") => {
    if (current.current.surface === "pdf" && pdfLocked.current) return;
    const at = Math.max(current.current.durationMs, performance.now() - getSessionStart());
    const event = historyEvent(current.current, direction, at, activePage);
    if (event) liveEvents([event]);
  }, [getSessionStart, liveEvents, activePage]);

  const onHintRequested = useCallback((problemId: string, request: HintRequested) => {
    if (current.current.surface === "pdf" && pdfLocked.current) return;
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
    if (!autoHint || pdfInputLocked) return;
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
  }, [autoHint, state.stuckMarks, onHintRequested, pdfInputLocked]);
  const clear = useCallback((rowId: string) => {
    if (current.current.surface === "pdf" && pdfLocked.current) return;
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
    // Replacing the timeline is the explicit way to start working again after a PDF session ends.
    pdfLocked.current = false;
    drainingHint.current = false;
    setPdfEnding(false);
    setPdfEndRequested(false);
    hintRequestId.current++;
    cancelHint(); pendingHint.current = null; setPreparingHint(false);
    player.current?.cancel();
    loaded.current = rec;
    setError("");
    setReplayDone(false);
    setRevision((value) => value + 1); // Discard in-flight pointer drafts on replacement.
    const reset = () => { syncRestart(); conductor.reset(); replace({ ...createSessionState(rec.problems, rec.worksheetId, rec.rows, rec.surface === "pdf" ? "free" : rec.layout ?? "ruled"),
      ...(rec.surface ? { surface: rec.surface, fileId: rec.fileId, layout: "free" as const } : {}),
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
  }, [replace, sink, detect, syncRestart, conductor, cancelHint]);

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

  useEffect(() => () => { loadId.current++; hintRequestId.current++; player.current?.cancel(); player.current = null; }, []);
  const snapshotHook = useCallback<SnapshotHook>(({ upToRowId, problemId, marked = true }) => {
    const state = current.current;
    const row = state.rows.find((r) => r.id === upToRowId);
    return renderSnapshot({ strokes: state.strokes, rows: state.rows, clusters: listClusters(state),
      problemId: problemId ?? row?.problemId ?? "", upToRowId, marked, background: backgroundFor(upToRowId) });
  }, [backgroundFor]);
  const hintRequestHook = useCallback<HintRequestHook>((rowId, rung, trigger) =>
    buildHintRequest(current.current, rowId, rung, trigger, { sessionId, problemSource, background: backgroundFor(rowId) }), [sessionId, problemSource, backgroundFor]);
  // P4.2: load the hand font and MathJax when the work page mounts, before the first hint.
  const [mathReady, setMathReady] = useState(false);
  useEffect(() => {
    let live = true;
    void preloadInk().then((ready) => { if (live) setMathReady(ready); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!devBuild) return;
    window.__albert = { state, replayDone: (state.surface === "pdf" && !loaded.current ? sync.ready : replayDone) && !loading, renderSnapshot: snapshotHook, buildHintRequest: hintRequestHook,
      ...(serverSessionId === undefined ? {} : { sessionId: serverSessionId }), flushSession: sync.flush,
      mathReady, mathToSvg, renderSegment, revealWipe };
    return () => { delete window.__albert; };
  }, [state, replayDone, loading, snapshotHook, hintRequestHook, serverSessionId, sync.flush, sync.ready, mathReady]);

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
  async function downloadPdf() {
    if (savingPdf) return;
    setSavingPdf(true); setError("");
    try {
      const [{ captureAlbertPdf }, { buildPdfDownload }] = await Promise.all([
        import("@/lib/canvas/pdf-export-dom"), import("@/lib/canvas/pdf-download"),
      ]);
      conductor.interrupt();
      await conductor.idle();
      // Capture state and rendered notes together, after asynchronous preparation has finished.
      const s = current.current;
      if (s.surface !== "pdf" || !s.fileId || !root.current) throw new Error("PDF unavailable");
      const albert = captureAlbertPdf([...root.current.querySelectorAll<SVGSVGElement>("svg[data-page]")]);
      const [source, font] = await Promise.all([fetch(`/api/files/${encodeURIComponent(s.fileId)}`), fetch("/fonts/Kalam-Regular.ttf")]);
      if (!source.ok || !font.ok) throw new Error("PDF assets unavailable");
      const bytes = await buildPdfDownload({ pdf: new Uint8Array(await source.arrayBuffer()), fontBytes: new Uint8Array(await font.arrayBuffer()), strokes: s.strokes, albert });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url; link.download = `${worksheetTitle ?? worksheetId} — annotated.pdf`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Could not save the PDF. Your writing is still here. Try again."); }
    finally { setSavingPdf(false); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = "session.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function endSession() {
    if (current.current.surface !== "pdf") { await sync.end(); return; }
    if (pdfLocked.current || hint.status === "streaming") return;
    // Lock synchronously: queued pointer/timer callbacks must not create a successor session.
    pdfLocked.current = true;
    setPdfEnding(true);
    setPdfEndRequested(true);
    hintRequestId.current++;
    hint.cancel();
    setPreparingHint(false);
    player.current?.cancel();
    conductor.interrupt();
    drainingHint.current = true;
    try {
      // Record any already queued completed hint before the final event flush.
      await conductor.idle();
      drainingHint.current = false;
      await sync.end();
    } finally {
      drainingHint.current = false;
      setPdfEnding(false); // An error leaves the existing session open and editable for retry.
    }
  }

  return <div ref={root} data-pdf-worksheet={state.surface === "pdf" ? "" : undefined}>
    <div role="group" aria-label="Ink tools" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
      <button type="button" disabled={pdfInputLocked} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>Pen</button>
      <button type="button" disabled={pdfInputLocked} aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>Eraser</button>
      <button type="button" disabled={pdfInputLocked || !historyEvent(state, "undo", state.durationMs, activePage)} onClick={() => history("undo")}>Undo</button>
      <button type="button" disabled={pdfInputLocked || !historyEvent(state, "redo", state.durationMs, activePage)} onClick={() => history("redo")}>Redo</button>
      <button type="button" disabled={sync.status === "ending" || sync.status === "ended" || pdfInputLocked || (state.surface === "pdf" && hint.status === "streaming")} onClick={() => void endSession()}>End session</button>
      {state.surface === "pdf" && <>
        <button type="button" disabled={savingPdf || !sync.ready || !pages.length} onClick={() => void downloadPdf()}>{savingPdf ? "Saving PDF…" : "Save PDF"}</button>
        <span role="status">Page {activePage} · {sync.ready ? "Autosave on" : "Opening saved writing…"}</span>
      </>}
    </div>
    {devTools && <DevToolbar speed={speed} onSpeed={setSpeed}
      onLoad={(file) => void load(file)} onExport={download} onPlay={() => start(loaded.current ?? snapshot(), speed)}
      onSnapshot={openSnapshot} />}
    {devTools && state.problems[0] && <button type="button"
      disabled={pdfInputLocked || hint.status === "streaming"}
      onClick={() => {
        const problem = state.problems[0];
        if (problem) void requestHint(problem.id, `${problem.id}/r3`, 1);
      }}>Request mock hint</button>}
    {sync.status === "ended" && <p role="status">Session ended. Your work is saved.</p>}
    {sync.status === "error" && <p role="alert">{state.surface === "pdf" ? "Could not load or save your writing." : "Could not save your session. Check your connection and try again."} <button type="button" onClick={() => void sync.retry()}>Try again</button></p>}
    {error && <p role="alert">{error}</p>}
    {state.surface === "pdf" && <>
      {pageError && <p role="alert">{pageError}</p>}
      {!pages.length && !pageError && <p role="status">Opening PDF pages…</p>}
      {pages.map(page => <PdfPageBlock key={`${revision}/${state.fileId}/${page.page}/${params.get("problem") ?? ""}`} page={page} fileId={state.fileId!}
        problems={state.problems} regions={pdfProblems} state={state} active={activePage === page.page}
        disabled={pdfInputLocked}
        onActivate={() => setActivePage(page.page)} onStroke={capture} getSessionStart={getSessionStart}
        tool={tool} conductor={conductor} hintText={hintText} hintTarget={hintTarget} hintInk={hintInk}
        hintDisabled={pdfInputLocked || hint.status === "streaming"} onHintRequested={onHintRequested} onMoreHelp={(problemId, rowId, rung) => void requestHint(problemId, rowId, rung)}
        onAsk={(problemId, rowId, question, page) => void requestHint(problemId, rowId, 1, "manual", question, page)} />)}
    </>}
    {state.surface !== "pdf" && state.problems.map((problem) => {
      const rows = state.rows.filter((row) => row.problemId === problem.id);
      return <ProblemBlock key={`${revision}/${problem.id}`} problem={problem} rows={rows}
        strokes={state.strokes.filter((stroke) => stroke.problemId === problem.id)}
        hintText={hintTarget?.problemId === problem.id ? hintText : undefined}
        hintRowId={hintTarget?.problemId === problem.id ? hintTarget.rowId : undefined}
        stuckMark={state.stuckMarks[problem.id]}
        hintDisabled={hint.status === "streaming" || isProblemSolved(state.events, problem.id)}
        onHintRequested={(request) => onHintRequested(problem.id, request)}
        onAsk={(question, rowId) => void requestHint(problem.id, rowId, 1, "manual", question)}
        askDisabled={isProblemSolved(state.events, problem.id)}
        getSessionStart={getSessionStart} onStroke={capture} tool={tool} onClearRow={clear} layout={state.layout}
        albertLayer={<AlbertLayer problemId={problem.id} conductor={conductor} />}
        rowTip={(rowId) => <ReadingTip reading={conductor.latestReading().find((r) => r.rowId === rowId)} />}
        albertExtent={conductor.problemInk(problem.id).extent}
        albertOverlay={({ height }) => <AlbertControls problemId={problem.id} conductor={conductor} height={height}
          onMoreHelp={(rowId, rung) => { if (!isProblemSolved(current.current.events, problem.id)) void requestHint(problem.id, rowId, rung as Rung); }} />}
        hintInk={hintInk && hintTarget?.problemId === problem.id}
        onPenDown={() => conductor.interrupt()}
        devOverlay={devTools ? <ClusterOverlay clusters={listClusters(state, rows.map((row) => row.id))}
          lines={state.layout === "free" ? rows : undefined} /> : undefined} />;
    })}
  </div>;
}
