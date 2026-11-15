"use client";

import { useCallback } from "react";
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
