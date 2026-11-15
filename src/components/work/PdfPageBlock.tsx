"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PAGE, INK, type Rung, type SessionRecording, type Stroke, type Worksheet } from "@/lib/contracts";
import { pageHeight, problemForStroke, type PdfPage, type SessionState } from "@/lib/canvas";
import type { Conductor } from "@/lib/ink";
import { WorkSurface } from "./WorkSurface";
import { AlbertControls, AlbertLayer } from "./AlbertLayer";
import type { HintRequested } from "./ProblemBlock";

/** A printed page owns input; the picker supplies identity where extraction found no region. */
export function PdfPageBlock({ page, fileId, problems, regions, state, active, disabled = false, onActivate, onStroke, getSessionStart, tool,
  conductor, hintText, hintTarget, hintInk, hintDisabled, onHintRequested, onMoreHelp }: {
  page: PdfPage; fileId: string; problems: SessionRecording["problems"]; regions: Worksheet["problems"]; state: SessionState;
  active: boolean; onActivate: () => void; onStroke: (stroke: Stroke) => void; getSessionStart: () => number; tool: Stroke["tool"];
  disabled?: boolean;
  onMoreHelp: (problemId: string, rowId: string, rung: Rung) => void;
  conductor: Conductor; hintText: string; hintTarget: { problemId: string; rowId: string } | null;
  hintInk: boolean; hintDisabled: boolean; onHintRequested: (problemId: string, request: HintRequested) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const wanted = useSearchParams().get("problem");
  const linked = regions.find(p => p.label === wanted && (p.region?.page ?? p.page) === page.page);
  useEffect(() => { if (linked) section.current?.scrollIntoView({ block: "start" }); }, [linked]);
  const [selected, setSelected] = useState(() => linked?.id ?? regions.find(p => p.region?.page === page.page || p.page === page.page)?.id ?? problems[0]?.id ?? "");
  const [imageError, setImageError] = useState(false);
  const local = state.rows.filter(r => r.page === page.page);
  const inked = state.strokes.filter(s => s.page === page.page && s.problemId === selected && s.tool === "pen" && s.erasedAt === undefined);
  const latest = inked.toSorted((a, b) => b.t1 - a.t1)[0];
  const signal = state.stuckMarks[selected];
  const stuck = signal && local.some(r => r.id === signal.rowId) ? signal : undefined;
  const rowId = stuck?.rowId ?? latest?.rowId;
  const height = pageHeight(page);
  const pageProblems = problems.filter(p => local.some(r => r.problemId === p.id));
  const hintedHere = hintTarget && local.some(r => r.id === hintTarget.rowId);
  const extent = Math.max(height + (hintedHere ? 180 : 0), conductor.pageExtent(page.page));
  return <section ref={section} data-highlighted={linked ? "" : undefined} data-pdf-page={page.page} aria-label={`PDF page ${page.page}`} data-active-page={active}
    onPointerDownCapture={() => { onActivate(); conductor.interrupt(); }} onFocusCapture={onActivate}>
    <div role="group" aria-label={`Page ${page.page} problem`} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 24 }}>
      <strong>Page {page.page} · Problem</strong>
      {problems.map(p => <button key={p.id} type="button" aria-pressed={selected === p.id} aria-label={`Problem ${p.label}`}
        onClick={() => setSelected(p.id)}>{p.label}</button>)}
      <button type="button" disabled={hintDisabled || !rowId}
        onClick={() => rowId && onHintRequested(selected, { rowId, rung: 1, trigger: "manual" })}>I&apos;m stuck</button>
      {stuck && <button type="button" data-stuck-row={stuck.rowId} disabled={hintDisabled}
        onClick={() => onHintRequested(selected, { rowId: stuck.rowId, rung: 1, trigger: stuck.kind })}>Need a hint?</button>}
    </div>
    {imageError && <p role="alert">Could not load this page image. Reload to try again.</p>}
    <WorkSurface problemId={selected} page={page.page} pageHeight={height} height={extent} disabled={disabled}
      strokes={state.strokes.filter(s => s.page === page.page)} tool={tool} getSessionStart={getSessionStart}
      onStroke={stroke => {
        const problemId = problemForStroke(stroke, regions, selected);
        if (stroke.tool === "pen") setSelected(problemId);
        onStroke({ ...stroke, problemId });
      }}
      albertLayer={pageProblems.map(p => <AlbertLayer key={p.id} problemId={p.id} page={page.page} conductor={conductor} />)}
      overlay={<>{!disabled && pageProblems.map(p => <AlbertControls key={p.id} problemId={p.id} conductor={conductor} height={extent} rowIds={local.map(r => r.id)}
        onMoreHelp={(rowId, rung) => { const row = local.find(r => r.id === rowId); if (row) onMoreHelp(p.id, rowId, rung as Rung); }} />)}</>}>
      <image data-pdf-background="" href={`/api/files/${encodeURIComponent(fileId)}/page/${page.page}`}
        x={0} y={0} width={PAGE.width} height={height} preserveAspectRatio="none" pointerEvents="none" onError={() => setImageError(true)} />
      {hintedHere && <foreignObject x={16} y={height + 16} width={PAGE.width - 32} height={160} pointerEvents="none">
        <div data-albert-column="" role="note" aria-live="polite" style={{ color: INK.albert, ...(hintInk ? { opacity: 0 } : {}) }}>{hintText}</div>
      </foreignObject>}
    </WorkSurface>
  </section>;
}
