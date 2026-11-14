"use client";

import { memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { INK, PAGE, type Point, type Stroke } from "@/lib/contracts";
import { attachCapture, strokePath } from "@/lib/canvas";

const FinishedStroke = memo(function FinishedStroke({ stroke }: { stroke: Stroke }) {
  return <path data-stroke-id={stroke.id} data-row-id={stroke.rowId}
    data-stroke-problem-id={stroke.problemId} d={strokePath(stroke.points)} fill={INK.student} />;
});

export function WorkSurface({ problemId, height = 600, onStroke, strokes: completedStrokes, children }: {
  problemId: string;
  height?: number;
  onStroke?: (stroke: Stroke) => void;
  strokes?: Stroke[];
  children?: ReactNode;
}) {
  const surface = useRef<SVGSVGElement>(null);
  const livePath = useRef<SVGPathElement>(null);
  const sessionStart = useRef<number | null>(null);
  const onStrokeRef = useRef(onStroke);
  const controlled = useRef(completedStrokes !== undefined);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const clipId = useId();

  useEffect(() => {
    onStrokeRef.current = onStroke;
    controlled.current = completedStrokes !== undefined;
  }, [onStroke, completedStrokes]);

  useEffect(() => {
    const svg = surface.current!;
    sessionStart.current ??= performance.now();
    let frame: number | null = null;
    let pending: readonly Point[] = [];
    const cancelFrame = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const detach = attachCapture(svg, {
      problemId, sessionStart: sessionStart.current,
      onPreview(points) {
        pending = points;
        if (!points.length) {
          cancelFrame();
          livePath.current?.setAttribute("d", "");
        } else if (frame === null) {
          frame = requestAnimationFrame(() => {
            frame = null;
            livePath.current?.setAttribute("d", strokePath(pending, false));
          });
        }
      },
      onStroke(stroke) {
        if (!controlled.current) setStrokes((previous) => [...previous, stroke]);
        onStrokeRef.current?.(stroke);
      },
    });
    svg.dataset.captureReady = "true";
    return () => {
      detach();
      cancelFrame();
      delete svg.dataset.captureReady;
    };
  }, [problemId]);

  return (
    <svg ref={surface} role="img" aria-label="Worksheet work surface"
      viewBox={`0 0 ${PAGE.width} ${height}`}
      style={{ display: "block", width: "100%", height: "auto", marginTop: 24, background: "#fff", touchAction: "none", userSelect: "none" }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={PAGE.studentCol.x} y={0} width={PAGE.studentCol.w} height={height} />
        </clipPath>
      </defs>
      {children}
      <g clipPath={`url(#${clipId})`}>
        {(completedStrokes ?? strokes).map((stroke) => <FinishedStroke key={stroke.id} stroke={stroke} />)}
      </g>
      <path ref={livePath} data-live-stroke="" d="" fill={INK.student} />
    </svg>
  );
}
