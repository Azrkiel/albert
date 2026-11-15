"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { ScopeBundle, Worksheet } from "@/lib/contracts";

type UnitTag = { order: number; title: string };

/** "Due Nov 21, 2026" from an ISO instant, in UTC so server and browser agree. */
function dueLabel(dueAt: string): string {
  return `Due ${new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/**
 * P5.6 chrome around the canvas: title, unit tag, due date, the Original drawer (the worksheet PDF in an iframe),
 * and the `?problem=<label>` deep link. The canvas itself is passed in as children and is not changed.
 */
export function WorksheetShell({ worksheet, children }: { worksheet: Pick<Worksheet, "id" | "title" | "fileId" | "dueAt" | "problems">; children: ReactNode }) {
  const params = useSearchParams();
  const wanted = params.get("problem");
  const target = worksheet.problems.find((problem) => problem.label === wanted);
  const [open, setOpen] = useState(false);
  const [problemId, setProblemId] = useState(target?.id ?? worksheet.problems[0]?.id);
  const [tags, setTags] = useState<Record<string, UnitTag | null>>({});
  const requested = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);

  // Deep link: scroll to the problem and mark it. The attribute is ours; React never writes it.
  useEffect(() => {
    if (!target) return;
    const section = root.current?.querySelector<HTMLElement>(`section[data-problem-id="${CSS.escape(target.id)}"]`);
    if (!section) return;
    section.setAttribute("data-highlighted", "");
    section.scrollIntoView({ block: "start" });
    return () => section.removeAttribute("data-highlighted");
  }, [target]);

  // The scope bundle of the open problem, fetched once per problem; only its unit is shown.
  useEffect(() => {
    if (!problemId || requested.current.has(problemId)) return;
    requested.current.add(problemId);
    const url = `/api/scope/${encodeURIComponent(worksheet.id)}?problemId=${encodeURIComponent(problemId)}`;
    void fetch(url).then(async (response) => {
      const bundle: ScopeBundle | null = response.ok ? await response.json() : null;
      setTags((prev) => ({ ...prev, [problemId]: bundle ? { order: bundle.card.order, title: bundle.card.title } : null }));
    }).catch(() => setTags((prev) => ({ ...prev, [problemId]: null })));
  }, [problemId, worksheet.id]);

  const tag = problemId ? tags[problemId] : undefined;
  return (
    <div ref={root} data-worksheet-shell=""
      onPointerDownCapture={(event) => {
        const id = (event.target as Element).closest("section[data-problem-id]")?.getAttribute("data-problem-id");
        if (id) setProblemId(id);
      }}>
      <header className="worksheet-header">
        <h2 data-worksheet-title="" className="worksheet-header__title">{worksheet.title}</h2>
        {tag && <span data-unit-tag="" className="worksheet-header__meta">{`Unit ${tag.order} · ${tag.title}`}</span>}
        {worksheet.dueAt && <span data-due="" className="worksheet-header__meta">{dueLabel(worksheet.dueAt)}</span>}
        <button type="button" data-original-toggle="" aria-expanded={open} aria-controls="worksheet-original"
          onClick={() => setOpen((value) => !value)} className="btn-secondary worksheet-header__original">Original</button>
      </header>
      {open && <aside id="worksheet-original" data-original-drawer="" aria-label="Original worksheet"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(560px, 100vw)", zIndex: 20, background: "#fff",
          borderLeft: "1px solid #ded8cf", boxShadow: "-4px 0 16px rgba(0,0,0,.12)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px" }}>
          <strong>Original</strong>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </div>
        <iframe title={`${worksheet.title} (original PDF)`} src={`/api/files/${encodeURIComponent(worksheet.fileId)}`}
          style={{ flex: 1, border: 0, width: "100%" }} />
      </aside>}
      {children}
      <style>{"section[data-highlighted] { outline: 3px solid #f2c14e; outline-offset: 6px; scroll-margin-top: 16px; }"}</style>
    </div>
  );
}
