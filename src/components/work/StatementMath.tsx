"use client";

import { useEffect, useRef } from "react";
import { mathToSvg } from "@/lib/ink";

/** Splits "text $latex$ text" into plain and math parts. A statement with no `$` is all text. */
export function splitStatement(source: string): Array<{ math: boolean; value: string }> {
  return source.split("$").map((value, i) => ({ math: i % 2 === 1, value })).filter((part) => part.value !== "");
}

/**
 * P5.6: a problem statement with its `$...$` parts typeset by MathJax (P4.2 helper) in black.
 * The raw source shows until MathJax arrives and stays in `data-latex` for tests and assistive tech.
 */
export function StatementMath({ source }: { source: string }) {
  const host = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !source.includes("$")) return;
    let live = true;
    void Promise.all(splitStatement(source).map(async (part) => {
      if (!part.math) return document.createTextNode(part.value);
      const math = await mathToSvg(part.value, 22);
      math.node.setAttribute("color", "#000");
      // Albert-ink selectors match data-ink-math; this is the student-facing statement, not Albert ink.
      math.node.removeAttribute("data-ink-math");
      math.node.removeAttribute("data-ink-math-fallback");
      math.node.setAttribute("data-statement-math", "");
      const wrap = document.createElement("span");
      wrap.style.cssText = `display:inline-block;vertical-align:${-(math.h - math.baseline)}px;margin:0 4px;`;
      wrap.append(math.node);
      return wrap;
    })).then((nodes) => { if (live) el.replaceChildren(...nodes); });
    return () => { live = false; };
  }, [source]);
  return <p ref={host} data-problem-statement="" data-latex={source} style={{ fontSize: 18 }}>{source}</p>;
}
