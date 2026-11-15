"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { INK, PAGE } from "@/lib/contracts";
import { mathToSvg, type Conductor } from "@/lib/ink";

/**
 * Albert's ink for one problem: an empty `<g class="albert">` the conductor draws into. It sits above
 * the student's ink and takes no pointer events, so the pen keeps working underneath (P4.3).
 */
export function AlbertLayer({ problemId, conductor }: { problemId: string; conductor: Conductor }) {
  const ref = useCallback((el: SVGGElement | null) => {
    conductor.attach(problemId, el);
    return () => conductor.attach(problemId, null);
  }, [problemId, conductor]);
  return <g ref={ref} className="albert" data-albert-layer="" data-albert-problem={problemId} pointerEvents="none" />;
}

/**
 * The two HTML controls around Albert's ink (P4.4): the "More help" chip under the latest hint and
 * "Clear Albert's notes". Absolutely positioned over the surface (`height` is its logical height).
 */
export function AlbertControls({ problemId, conductor, height, onMoreHelp }: {
  problemId: string; conductor: Conductor; height: number;
  onMoreHelp: (rowId: string, rung: number) => void;
}) {
  const ink = useSyncExternalStore(conductor.subscribe, () => conductor.problemInk(problemId), () => conductor.problemInk(problemId));
  const { chip } = ink;
  return <>
    {chip && <button type="button" data-albert-chip="" onClick={() => onMoreHelp(chip.rowId, chip.rung)}
      style={{ position: "absolute", left: `${chip.x / PAGE.width * 100}%`,
        top: `${Math.min(chip.y + 6, height - 36) / height * 100}%`, padding: "4px 12px", cursor: "pointer",
        border: `1px solid ${INK.albert}`, borderRadius: 14, background: "transparent", color: INK.albert, font: "inherit", fontSize: 15 }}>
      More help
    </button>}
    {ink.hasInk && <button type="button" data-albert-clear="" onClick={() => conductor.clearProblem(problemId)}
      style={{ position: "absolute", right: "1%", bottom: 6, padding: "2px 8px", cursor: "pointer", border: 0,
        background: "transparent", color: "#76726b", font: "inherit", fontSize: 13, textDecoration: "underline" }}>
      Clear Albert&apos;s notes
    </button>}
  </>;
}

/**
 * "What Albert read" (P4.6): the row as Albert's reader transcribed it in the latest `reading` event, typeset,
 * with its confidence. Rendered inside a row-number button and shown by CSS on hover or focus (or by a long press).
 */
export function ReadingTip({ reading }: { reading: { latex: string; confidence: string } | undefined }) {
  const host = useRef<HTMLSpanElement>(null);
  const latex = reading?.latex;
  useEffect(() => {
    const el = host.current;
    if (!el || latex === undefined) return;
    let live = true;
    void mathToSvg(latex, 20).then((math) => { if (live) el.replaceChildren(math.node.cloneNode(true)); });
    return () => { live = false; };
  }, [latex]);
  if (!reading) return null;
  return <span role="tooltip" data-reading-tip="" style={{ position: "absolute", left: 34, top: -2, zIndex: 5, display: "none",
    background: "#fff", border: "1px solid #ded8cf", borderRadius: 6, padding: "6px 10px", whiteSpace: "nowrap",
    textAlign: "left", color: "#1b1b1f", fontSize: 13, boxShadow: "0 2px 8px rgba(0,0,0,.12)", pointerEvents: "none" }}>
    <span style={{ display: "block", color: "#76726b" }}>What Albert read ({reading.confidence})</span>
    <span ref={host} data-reading-math="" style={{ display: "block", minHeight: 24 }} />
  </span>;
}
