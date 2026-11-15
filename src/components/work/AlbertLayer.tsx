"use client";

import { useCallback, useSyncExternalStore } from "react";
import { INK, PAGE } from "@/lib/contracts";
import type { Conductor } from "@/lib/ink";

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
      style={{ position: "absolute", left: `${(PAGE.albertCol.x + 16) / PAGE.width * 100}%`,
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
