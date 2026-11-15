"use client";

import { useId, type ReactNode } from "react";
import { INK, PAGE, type CanvasLayout, type Row, type Stroke, type StuckSignal, type Worksheet } from "@/lib/contracts";
import { freeSurfaceHeight, inkedRowIds } from "@/lib/canvas";
import { WorkSurface } from "./WorkSurface";

// Phase 5 owns loading/typesetting. Accept its existing contract metadata directly.
type Problem = Pick<Worksheet["problems"][number], "id" | "label" | "statementLatex">;

export type HintRequested = { rowId: string; rung: 1; trigger: StuckSignal["kind"] };

export function ProblemBlock({ problem, rows, strokes, onStroke, getSessionStart, tool, onClearRow, hintText, hintRowId, devOverlay, albertLayer, albertExtent, albertOverlay, hintInk, onPenDown, layout = "ruled", stuckMark, onHintRequested, hintDisabled }: {
  problem: Problem;
  rows: Row[];
  strokes: Stroke[];
  onStroke: (stroke: Stroke) => void;
  getSessionStart: () => number;
  tool?: Stroke["tool"];
  onClearRow?: (rowId: string) => void;
  hintText?: string;
  hintRowId?: string;
  stuckMark?: StuckSignal;
  onHintRequested?: (request: HintRequested) => void;
  hintDisabled?: boolean;
  /** SVG drawn above the ink (the ?dev=1 cluster overlay); omitted in normal use. */
  devOverlay?: ReactNode;
  /** Albert's ink layer (P4.3), drawn above everything else on the surface. */
  albertLayer?: ReactNode;
  /** Albert's HTML controls (More help, Clear notes), given the surface's logical height. */
  /** Page y Albert's writing reaches; the surface grows to fit it. */
  albertExtent?: number;
  albertOverlay?: (info: { height: number }) => ReactNode;
  /** True once Albert's writing is drawn as ink: the plain-text column then stays for screen readers only. */
  hintInk?: boolean;
  /** The pen went down on this problem: finish Albert's running animations. */
  onPenDown?: () => void;
  /** "free": rows are inferred lines, drawn without rules; only lines with live ink get a number. */
  layout?: CanvasLayout;
}) {
  const headingId = useId();
  const free = layout === "free";
  const rowsHeight = free ? freeSurfaceHeight(rows) : Math.max(...rows.map((row) => row.bbox.y + row.bbox.h));
  const height = Math.max(rowsHeight, albertExtent ?? 0);
  const inked = inkedRowIds(strokes);
  const numbered = free ? rows.filter((row) => inked.has(row.id)) : rows;
  const markRow = rows.find((row) => row.id === stuckMark?.rowId);
  const manualRow = strokes.findLast((stroke) => stroke.tool === "pen" && stroke.erasedAt === undefined && inked.has(stroke.rowId ?? ""))?.rowId ?? rows[0]?.id;

  return (
    <section data-problem-id={problem.id} aria-labelledby={headingId} style={{ marginTop: 32 }} onPointerDownCapture={onPenDown}>
      {/* HTML controls stay accessible outside the SVG's atomic img role. */}
      <WorkSurface problemId={problem.id} height={height} strokes={strokes}
        onStroke={onStroke} getSessionStart={getSessionStart} tool={tool} svgOverlay={devOverlay} albertLayer={albertLayer}
        overlay={<>{albertOverlay?.({ height })}{onClearRow && numbered.map((row) => <button key={row.id} type="button" data-row-number=""
          aria-label={`Clear row ${row.index} of problem ${problem.label}`}
          title={`Clear row ${row.index}`} onClick={() => onClearRow(row.id)}
          style={{ position: "absolute", left: `${row.bbox.x / PAGE.width * 100 + 0.5}%`, top: `${(row.bbox.y + 2) / height * 100}%`,
            width: 32, height: 32, padding: 0, background: "transparent", border: 0, color: "#76726b", cursor: "pointer" }}>
          {row.index}
        </button>)}
          {stuckMark && markRow && <button key={`${stuckMark.rowId}/${stuckMark.at}`} type="button"
            aria-label="Need a hint?" data-stuck-row={stuckMark.rowId} disabled={hintDisabled}
            onClick={() => onHintRequested?.({ rowId: stuckMark.rowId, rung: 1, trigger: stuckMark.kind })}
            style={{ position: "absolute", left: `${(PAGE.albertCol.x + 16) / PAGE.width * 100}%`,
              top: `${(markRow.bbox.y + markRow.bbox.h / 2) / height * 100}%`, transform: "translateY(-50%)",
              display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: 0, background: "transparent",
              color: INK.albert, cursor: "pointer", animation: "albert-hint-appear 250ms ease-out both" }}>
            <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 22, height: 22,
              border: "1px solid currentColor", borderRadius: "50%" }}>?</span>
            <span>Need a hint?</span>
          </button>}
        </>}>
        <g data-problem-decoration="" pointerEvents="none">
          <rect data-albert-margin="" x={PAGE.albertCol.x} y={0}
            width={PAGE.albertCol.w} height={height} fill="#faf7f2" />
          <line data-margin-rule="" x1={PAGE.albertCol.x} x2={PAGE.albertCol.x}
            y1={0} y2={height} stroke="#ded8cf" strokeWidth={1} />
          <foreignObject x={PAGE.albertCol.x + 16}
            y={rows.find((row) => row.id === hintRowId)?.bbox.y ?? PAGE.statementMinHeight}
            width={PAGE.albertCol.w - 32} height={PAGE.rowHeight * 2}>
            <div data-albert-column="" role="note" aria-live="polite" aria-label={`Albert's hints for problem ${problem.label}`}
              style={{ color: INK.albert, fontSize: 20, whiteSpace: "pre-wrap", paddingTop: PAGE.rowPaddingTop, ...(hintInk ? { opacity: 0 } : {}) }}>
              {hintText}
            </div>
          </foreignObject>
          <foreignObject x={PAGE.studentCol.x + 16} y={0} width={PAGE.studentCol.w - 32} height={PAGE.statementMinHeight}>
            <div style={{ paddingTop: PAGE.rowPaddingTop, height: "100%", overflow: "auto" }}>
              <h2 id={headingId} style={{ fontSize: 20, margin: "0 0 8px" }}>Problem {problem.label}</h2>
              <p data-problem-statement="" style={{ fontSize: 18 }}>{problem.statementLatex}</p>
            </div>
          </foreignObject>
          {numbered.map((row) => (
            <g key={row.id} data-row-id={row.id}>
              {!free && <line x1={row.bbox.x} x2={row.bbox.x + row.bbox.w}
                y1={row.bbox.y + row.bbox.h} y2={row.bbox.y + row.bbox.h} stroke="#e7e5df" strokeWidth={1} />}
              {!onClearRow && <text data-row-number="" x={row.bbox.x + 8} y={row.bbox.y + PAGE.rowPaddingTop + 12}
                fill="#aaa69e" fontSize={14}>{row.index}</text>}
            </g>
          ))}
        </g>
      </WorkSurface>
      <button type="button" disabled={hintDisabled || !manualRow}
        onClick={() => manualRow && onHintRequested?.({ rowId: manualRow, rung: 1, trigger: "manual" })}>I&apos;m stuck</button>
      <style>{"@keyframes albert-hint-appear { from { opacity: 0; } to { opacity: 1; } } @media (prefers-reduced-motion: reduce) { [data-stuck-row] { animation: none !important; } }"}</style>
    </section>
  );
}
