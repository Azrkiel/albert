"use client";

import { useId, useState } from "react";
import { PAGE, type Worksheet } from "@/lib/contracts";
import { addCompletedStroke, createSessionState } from "@/lib/canvas";
import { WorkSurface } from "./WorkSurface";

// Phase 5 owns loading/typesetting. Accept its existing contract metadata directly.
type Problem = Pick<Worksheet["problems"][number], "id" | "label" | "statementLatex">;

export function ProblemBlock({ problem }: { problem: Problem }) {
  const [state, setState] = useState(() => createSessionState([problem.id]));
  const headingId = useId();
  const height = state.rows[state.rows.length - 1]!.bbox.y + PAGE.rowHeight;

  return (
    <section data-problem-id={problem.id} aria-labelledby={headingId} style={{ marginTop: 32 }}>
      <WorkSurface problemId={problem.id} height={height} strokes={state.strokes}
        onStroke={(stroke) => setState((previous) => addCompletedStroke(previous, problem.id, stroke))}>
        <g data-problem-decoration="" pointerEvents="none">
          <rect data-albert-margin="" x={PAGE.albertCol.x} y={0}
            width={PAGE.albertCol.w} height={height} fill="#faf7f2" />
          <line data-margin-rule="" x1={PAGE.albertCol.x} x2={PAGE.albertCol.x}
            y1={0} y2={height} stroke="#ded8cf" strokeWidth={1} />
          <foreignObject x={PAGE.studentCol.x + 16} y={0} width={PAGE.studentCol.w - 32} height={PAGE.statementMinHeight}>
            <div style={{ paddingTop: PAGE.rowPaddingTop, height: "100%", overflow: "auto" }}>
              <h2 id={headingId} style={{ fontSize: 20, margin: "0 0 8px" }}>Problem {problem.label}</h2>
              <p data-problem-statement="" style={{ fontSize: 18 }}>{problem.statementLatex}</p>
            </div>
          </foreignObject>
          {state.rows.map((row) => (
            <g key={row.id} data-row-id={row.id}>
              <line x1={row.bbox.x} x2={row.bbox.x + row.bbox.w}
                y1={row.bbox.y + row.bbox.h} y2={row.bbox.y + row.bbox.h} stroke="#e7e5df" strokeWidth={1} />
              <text data-row-number="" x={row.bbox.x + 8} y={row.bbox.y + PAGE.rowPaddingTop + 12}
                fill="#aaa69e" fontSize={14}>{row.index}</text>
            </g>
          ))}
        </g>
      </WorkSurface>
    </section>
  );
}
