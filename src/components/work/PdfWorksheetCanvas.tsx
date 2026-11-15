"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { PAGE, type Rung, type SessionEvent, type Stroke, type Worksheet } from "@/lib/contracts";
import { createSessionState, reduceSessionEvent, listClusters, eraseGesture, historyEvent, buildHintRequest, renderSnapshot, type SessionState } from "@/lib/canvas";
import type { SnapshotBackground } from "@/lib/canvas/snapshot";
import { problemForStroke } from "@/lib/canvas/pdf-page";
import { createConductor, preloadInk } from "@/lib/ink";
import { useHint } from "@/lib/tutor/client";
import { hintMarginText } from "@/lib/tutor/error-notes";
import { WorkSurface } from "./WorkSurface";
import { AlbertLayer, AlbertControls } from "./AlbertLayer";
import { useSessionSync } from "./useSessionSync";
import "@/lib/ink/ink.css";

type PdfPage = { page: number; widthPt: number; heightPt: number };
const pageUrl = (fileId: string, page: number) => `/api/files/${encodeURIComponent(fileId)}/page/${page}`;

function backgroundFor(worksheet: Worksheet, pages: PdfPage[], rowId: string, state: SessionState): SnapshotBackground | undefined {
  const row = state.rows.find(r => r.id === rowId);
  const page = pages.find(p => p.page === row?.page);
  if (!page || !row) return;
  const height = PAGE.width * page.heightPt / page.widthPt;
  const problem = worksheet.problems.find(p => p.id === row.problemId);
  return { page: page.page, url: pageUrl(worksheet.fileId, page.page), width: PAGE.width, height,
    region: problem?.region?.page === page.page ? problem.region.bbox : { x: 0, y: 0, w: PAGE.width, h: height } };
}

/** A single worksheet timeline; page components own only presentation and hint animation. */
export function PdfWorksheetCanvas({ worksheet, pages, recorded }: { worksheet: Worksheet; pages: PdfPage[]; recorded: boolean }) {
  const [state, setState] = useState<SessionState>(() => ({ ...createSessionState(worksheet.problems, worksheet.id, undefined, "free"), surface: "pdf", fileId: worksheet.fileId }));
  const current = useRef(state);
  const origin = useRef<number | null>(null);
  const [sessionId, setSessionId] = useState<string>();
  const [activePage, setActivePage] = useState(1);
  const [tool, setTool] = useState<Stroke["tool"]>("pen");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const replace = useCallback((next: SessionState) => { current.current = next; setState(next); }, []);
  const sync = useSessionSync(worksheet.id, setSessionId, { resume: true, fileId: worksheet.fileId,
    onRestore: (_session, events) => {
      let restored = createSessionState(worksheet.problems, worksheet.id, undefined, "free");
      for (const event of events) restored = reduceSessionEvent(restored, event);
      const duration = Math.max(restored.durationMs, ...restored.strokes.map(s => s.t1));
      origin.current = performance.now() - duration;
      replace({ ...restored, surface: "pdf", fileId: worksheet.fileId });
    } });
  const getSessionStart = useCallback(() => origin.current ??= performance.now(), []);
  const now = useCallback(() => Math.max(current.current.durationMs, performance.now() - getSessionStart()), [getSessionStart]);
  const { push: syncPush } = sync;
  const sink = useCallback((event: SessionEvent) => {
    const next = reduceSessionEvent(current.current, event);
    if (next === current.current) return;
    replace(next);
    // Persist the reducer's completed row association, rather than the draft rowId:null.
    syncPush(next.events.at(-1)!);
  }, [replace, syncPush]);
  const capture = useCallback((stroke: Stroke) => {
    if (stroke.tool === "eraser") for (const event of eraseGesture(current.current, stroke.problemId, stroke.points, stroke.t1, stroke.page)) sink(event);
    else sink({ type: "stroke_end", at: stroke.t1, stroke });
  }, [sink]);
  const history = useCallback((direction: "undo" | "redo") => {
    const event = historyEvent(current.current, direction, now(), activePage);
    if (event) sink(event);
  }, [activePage, now, sink]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      event.preventDefault(); history(event.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [history]);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__albert = { state, replayDone: sync.ready, sessionId, flushSession: sync.flush,
      renderSnapshot: ({ upToRowId, marked = true }) => {
        const row = current.current.rows.find(r => r.id === upToRowId);
        return renderSnapshot({ strokes: current.current.strokes, rows: current.current.rows, clusters: listClusters(current.current),
          upToRowId, problemId: row?.problemId ?? "", marked, background: backgroundFor(worksheet, pages, upToRowId, current.current) });
      }, buildHintRequest: (rowId, rung, trigger) => buildHintRequest(current.current, rowId, rung, trigger,
        { sessionId, problemSource: "worksheet", background: backgroundFor(worksheet, pages, rowId, current.current) }) };
    return () => { delete window.__albert; };
  }, [state, sessionId, sync.ready, sync.flush, worksheet, pages]);

  async function savePdf() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/files/${encodeURIComponent(worksheet.fileId)}`);
      if (!response.ok) throw new Error("Original unavailable");
      const { exportWorksheetPdf } = await import("@/lib/ink/pdf-export-browser");
      const annotations = Array.from(root.current?.querySelectorAll<SVGSVGElement>("svg[data-page]") ?? []).flatMap(svg =>
        Array.from(svg.querySelectorAll<SVGGElement>("[data-albert-layer]")).map(layer => ({ page: Number(svg.dataset.page), svg: layer })));
      const bytes = await exportWorksheetPdf({ originalPdf: new Uint8Array(await response.arrayBuffer()), strokes: current.current.strokes, annotations });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }));
      const link = document.createElement("a"); link.href = url; link.download = `${worksheet.title} - annotated.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError("Could not save the PDF. Your writing is still here. Try again."); }
    finally { setSaving(false); }
  }

  return <div ref={root} data-pdf-worksheet="">
    <div role="group" aria-label="Ink tools" style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "20px 0" }}>
      <button type="button" aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>Pen</button>
      <button type="button" aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>Eraser</button>
      <button type="button" disabled={!historyEvent(state, "undo", state.durationMs, activePage)} onClick={() => history("undo")}>Undo</button>
      <button type="button" disabled={!historyEvent(state, "redo", state.durationMs, activePage)} onClick={() => history("redo")}>Redo</button>
      <button type="button" disabled={saving || !sync.ready} onClick={() => void savePdf()}>{saving ? "Saving PDF…" : "Save PDF"}</button>
      <span role="status" style={{ alignSelf: "center", color: "#76726b", fontSize: 14 }}>Page {activePage} · {sync.ready ? "Autosave on" : "Opening saved writing…"}</span>
    </div>
    {recorded && <p data-recorded-preview="" style={{ color: "#76726b", fontSize: 14 }}>Recorded preview: replies use saved examples and do not read your handwriting.</p>}
    {sync.status === "error" && <p role="alert">Could not load or save your writing. <button onClick={() => void sync.retry()}>Try again</button></p>}
    {error && <p role="alert">{error}</p>}
    {pages.map(page => <PdfInkPage key={page.page} page={page} worksheet={worksheet} state={state} current={current}
      disabled={!sync.ready} tool={tool} onStroke={capture} getSessionStart={getSessionStart} now={now} sink={sink}
      sessionId={sessionId} onActive={() => setActivePage(page.page)} />)}
  </div>;
}

function PdfInkPage({ page, worksheet, state, current, disabled, tool, onStroke, getSessionStart, now, sink, sessionId, onActive }: {
  page: PdfPage; worksheet: Worksheet; state: SessionState; current: { current: SessionState }; disabled: boolean;
  tool: Stroke["tool"]; onStroke: (stroke: Stroke) => void; getSessionStart: () => number; now: () => number;
  sink: (event: SessionEvent) => void; sessionId?: string; onActive: () => void;
}) {
  const params = useSearchParams();
  const height = PAGE.width * page.heightPt / page.widthPt;
  const pageProblems = worksheet.problems.filter(p => (p.region?.page ?? p.page) === page.page);
  const choices = pageProblems.length ? pageProblems : worksheet.problems;
  const initial = choices.find(p => p.label === params.get("problem")) ?? choices[0];
  const linked = choices.find(p => p.label === params.get("problem"))?.id;
  const [selection, setSelection] = useState({ id: initial?.id ?? "", linked });
  if (selection.linked !== linked) setSelection({ id: linked ?? selection.id, linked });
  const selected = selection.id;
  const setSelected = (id: string) => setSelection({ id, linked });
  const selectedRef = useRef(selected);
  const hint = useHint();
  const refs = useRef({ now, sink, height });
  useEffect(() => { refs.current = { now, sink, height }; selectedRef.current = selected; }, [now, sink, height, selected]);
  // eslint-disable-next-line react-hooks/refs
  const [conductor] = useState(() => createConductor({ geometry: () => ({ rows: current.current.rows.filter(r => r.page === page.page),
    clusters: listClusters(current.current, current.current.rows.filter(r => r.page === page.page).map(r => r.id)) }),
    reducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, narrow: () => true,
    pageMode: true, noteLabel: id => `Problem ${worksheet.problems.find(p => p.id === id)?.label ?? ""}`,
    bandTop: () => refs.current.height + 16, now: () => refs.current.now(),
    onShown: (ctx, marks) => refs.current.sink({ type: "hint_shown", at: refs.current.now(), hintId: ctx.hintId, marks }) }));
  useSyncExternalStore(conductor.subscribe, conductor.version, conductor.version);
  const context = useRef<{ hintId: string; seedId: string; problemId: string; rowId: string; rung: number } | null>(null);
  const feed = useRef(0);
  const requested = useRef(0);
  const replayed = useRef(new Set<SessionEvent>());
  const [localError, setLocalError] = useState("");
  useEffect(() => { void preloadInk(); return () => conductor.reset(); }, [conductor]);
  useEffect(() => {
    for (const event of state.events) {
      if (event.type !== "hint_shown" || replayed.current.has(event)) continue;
      replayed.current.add(event);
      const row = state.rows.find(r => r.id === (event.marks[0]?.spec.type === "arrow" ? event.marks[0].spec.toRowId : event.marks[0]?.spec.rowId));
      if (row?.page === page.page && !event.marks.some(m => m.hintId === context.current?.hintId)) conductor.replayShown(event.marks, { instant: true, rung: 1 });
    }
  }, [state.events, state.rows, page.page, conductor]);
  useEffect(() => {
    if (!context.current) return;
    while (feed.current < hint.events.length) conductor.handle(context.current, hint.events[feed.current++]!);
  }, [hint.events, conductor]);
  useEffect(() => () => { requested.current++; }, []);

  async function request(problemId: string, rowId: string, rung: Rung) {
    const requestId = ++requested.current;
    hint.cancel(); conductor.interrupt(); feed.current = 0; setLocalError("");
    const hintId = `hint-${sessionId}-${current.current.events.length}`;
    context.current = { hintId, seedId: hintId, problemId, rowId, rung };
    sink({ type: "hint_requested", at: now(), hintId, rowId, rung });
    try {
      const req = await buildHintRequest(current.current, rowId, rung, "manual", { sessionId, problemSource: "worksheet",
        background: backgroundFor(worksheet, [page], rowId, current.current) });
      if (requestId === requested.current) await hint.requestHint(req);
    } catch { if (requestId === requested.current) setLocalError("Could not prepare your writing. Try again."); }
  }
  const capture = (stroke: Stroke) => {
    const problemId = problemForStroke(stroke, worksheet.problems, selectedRef.current);
    onActive(); setSelected(problemId); selectedRef.current = problemId; conductor.interrupt();
    onStroke({ ...stroke, problemId });
    if (stroke.tool === "pen") {
      const rowId = current.current.strokes.find(s => s.id === stroke.id)?.rowId;
      if (rowId) conductor.inkAdded(problemId, rowId);
    }
  };
  const row = state.rows.filter(r => r.page === page.page && r.problemId === selected && (state.clusters[r.id]?.length ?? 0) > 0).at(-1);
  const extent = Math.max(height, ...choices.map(p => conductor.problemInk(p.id).extent));
  return <section data-pdf-page={page.page} data-problem-id={selected} aria-label={`PDF page ${page.page}`}
    onPointerDownCapture={onActive} style={{ margin: "24px 0 36px", border: "1px solid #ded8cf", borderRadius: 8, overflow: "hidden" }}>
    <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#faf8f4" }}>
      <strong>Page {page.page}</strong>
      <label>Problem <select aria-label={`Problem on page ${page.page}`} value={selected} onChange={e => { setSelected(e.target.value); onActive(); }}>
        {choices.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select></label>
      <button type="button" disabled={disabled || !row || hint.status === "streaming"} onClick={() => row && void request(selected, row.id, 1)}>I&apos;m stuck</button>
    </div>
    {localError && <p role="alert">{localError}</p>}
    {(hint.status === "streaming" || hint.status === "error") && <p role={hint.status === "error" ? "alert" : "status"}>{hintMarginText(hint.events) || "Getting a hint…"}</p>}
    <WorkSurface problemId={`pdf-page-${page.page}`} page={page.page} height={extent} drawingHeight={height} disabled={disabled}
      onPenDown={() => conductor.interrupt()} strokes={state.strokes.filter(s => s.page === page.page)} tool={tool} onStroke={capture} getSessionStart={getSessionStart}
      albertLayer={<>{choices.map(p => <AlbertLayer key={p.id} problemId={p.id} conductor={conductor} />)}</>}
      overlay={<>{choices.map(p => <AlbertControls key={p.id} problemId={p.id} conductor={conductor} height={extent}
        onMoreHelp={(rowId, rung) => void request(p.id, rowId, rung as Rung)} />)}</>}>
      <image href={pageUrl(worksheet.fileId, page.page)} x={0} y={0} width={PAGE.width} height={height} pointerEvents="none" />
    </WorkSurface>
  </section>;
}
