import type { EvalCase, HintEvent, HintRequest } from "../contracts";
import { hintText } from "./ladder";

/** What one live run of a case produced, reduced to what scoring needs. Times are ms from the request start. */
export type EvalObservation = {
  events: HintEvent[];
  firstInkMs: number | null;   // first `mark` or `hint` event
  totalMs: number;
  modelCalls: number;          // invocations of the hint model (2 = one repair)
};

/** Outside judgements from the reader model; `null` when not asked. */
export type EvalJudgements = {
  sameReading: boolean | null;     // asked only when the normalised LaTeX differs
  givesAnswer: boolean | null;     // asked only on rungs 1 and 2
};

export type CaseScore = {
  id: string;
  rung: number;
  read: boolean | null;
  status: boolean;
  row: boolean | null;       // error cases only
  clusters: boolean | null;  // error cases with expected labels only
  ladder: boolean;
  noAnswer: boolean | null;  // rungs 1 and 2 only
  scope: boolean;
  differs: boolean | null;   // when the same hint was asked again with nothing written
  citation: boolean | null;
  kind: boolean | null;
  firstInkMs: number | null;
  totalMs: number;
  error?: string;
  hint?: string;
  reading?: string;
  repair?: string;          // why the one repair call was needed (rule messages, no student content)
};

/** Spacing and TeX spelling differences that do not change the expression. */
export function normaliseLatex(latex: string): string {
  return latex
    .replace(/\\(left|right|displaystyle|,|;|!|:|quad|qquad)/g, "")
    .replace(/\\dfrac|\\tfrac/g, "\\frac")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/[\s{}]/g, "")
    .replace(/\$/g, "")
    .toLowerCase();
}

const labelOf = (clusterId: string) => Number(clusterId.slice(clusterId.lastIndexOf("/c") + 2));

/** Plain text of a hint, math kept as LaTeX, for mention checks. */
function mentionText(events: HintEvent[]): string {
  const hint = events.find((e) => e.type === "hint");
  return hint && hint.type === "hint" ? hintText(hint) : "";
}

function mentions(text: string, fragment: string): boolean {
  return text.toLowerCase().includes(fragment.toLowerCase()) || normaliseLatex(text).includes(normaliseLatex(fragment));
}

/** The reading of the stuck row, from the `reading` event. */
export function stuckRowReading(events: HintEvent[], request: HintRequest, stuckRowIndex: number): string | undefined {
  const rowId = request.rows.find((r) => r.index === stuckRowIndex)?.rowId;
  const reading = events.find((e) => e.type === "reading");
  return reading && reading.type === "reading" ? reading.rows.find((r) => r.rowId === rowId)?.latex : undefined;
}

/** Score one case. Pure: no model, clock or IO; judgements come in from outside. */
export function scoreCase(c: EvalCase, request: HintRequest, obs: EvalObservation, judged: EvalJudgements): CaseScore {
  const { events } = obs;
  const error = events.find((e) => e.type === "error");
  const diagnosis = events.find((e) => e.type === "diagnosis");
  const hint = events.find((e) => e.type === "hint");
  const done = events.some((e) => e.type === "done");
  const text = mentionText(events);
  const reading = stuckRowReading(events, request, c.stuckRowIndex);
  const errorCase = c.expect.status.includes("error");

  let read: boolean | null = null;
  if (c.expect.stuckRowLatex !== undefined) {
    read = reading !== undefined && (normaliseLatex(reading) === normaliseLatex(c.expect.stuckRowLatex) || judged.sameReading === true);
  }
  const status = !!diagnosis && diagnosis.type === "diagnosis" && c.expect.status.includes(diagnosis.status);
  const diagRowIndex = diagnosis && diagnosis.type === "diagnosis" ? request.rows.find((r) => r.rowId === diagnosis.rowId)?.index : undefined;
  const row = errorCase && c.expect.errorRowIndex !== undefined ? diagRowIndex === c.expect.errorRowIndex : null;
  const labels = diagnosis && diagnosis.type === "diagnosis" ? (diagnosis.clusterIds ?? []).map(labelOf) : [];
  const clusters = errorCase && c.expect.errorClusterLabels?.length ? labels.some((l) => c.expect.errorClusterLabels!.includes(l)) : null;
  const ladder = done && !error && obs.modelCalls === 1;
  const forbidden = c.expect.mustNotMention ?? [];
  const noAnswer = c.rung <= 2 ? !!hint && !forbidden.some((f) => mentions(text, f)) && judged.givesAnswer === false : null;
  const outOfScope = (c.expect.forbiddenMethods ?? []).some((m) => mentions(text, m));
  const scope = !!diagnosis && diagnosis.type === "diagnosis" && diagnosis.inScope && !outOfScope;
  const last = c.history?.at(-1);
  const differs = last && last.rowId === request.rowId && !last.studentWroteAfter
    ? !!hint && normaliseLatex(text) !== normaliseLatex(last.text) : null;
  const citation = c.expect.citationIncludes === undefined ? null
    : !!hint && hint.type === "hint" && !!hint.citation?.label.includes(c.expect.citationIncludes);
  const kind = c.expect.kind === undefined ? null : !!hint && hint.type === "hint" && c.expect.kind.includes(hint.kind);
  return {
    id: c.id, rung: c.rung, read, status, row, clusters, ladder, noAnswer, scope, differs, citation, kind,
    firstInkMs: obs.firstInkMs, totalMs: obs.totalMs,
    ...(error && error.type === "error" ? { error: error.code } : {}),
    ...(text ? { hint: text } : {}),
    ...(reading === undefined ? {} : { reading }),
  };
}

export const EVAL_BARS = { status: 0.85, row: 0.8, clusters: 0.7, ladder: 0.85, noAnswer: 1, scope: 1, firstInkMedianMs: 3000, firstInkP95Ms: 6000 } as const;

export type EvalTotals = {
  cases: number;
  status: number; row: number | null; clusters: number | null; ladder: number; noAnswer: number | null; scope: number;
  firstInkMedianMs: number | null; firstInkP95Ms: number | null;
  qualityPass: boolean; timingPass: boolean | null;
};

const share = (values: Array<boolean | null>): number | null => {
  const asked = values.filter((v): v is boolean => v !== null);
  return asked.length ? asked.filter(Boolean).length / asked.length : null;
};

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

export function totals(scores: CaseScore[]): EvalTotals {
  const status = share(scores.map((s) => s.status)) ?? 0;
  const row = share(scores.map((s) => s.row));
  const clusters = share(scores.map((s) => s.clusters));
  const ladder = share(scores.map((s) => s.ladder)) ?? 0;
  const noAnswer = share(scores.map((s) => s.noAnswer));
  const scope = share(scores.map((s) => s.scope)) ?? 0;
  const inks = scores.flatMap((s) => s.firstInkMs === null ? [] : [s.firstInkMs]);
  const firstInkMedianMs = percentile(inks, 0.5);
  const firstInkP95Ms = percentile(inks, 0.95);
  const b = EVAL_BARS;
  const qualityPass = scores.length > 0 && status >= b.status && (row ?? 1) >= b.row && (clusters ?? 1) >= b.clusters
    && ladder >= b.ladder && (noAnswer ?? 1) >= b.noAnswer && scope >= b.scope
    && scores.every((s) => s.differs !== false && s.citation !== false && s.kind !== false && s.read !== false);
  const timingPass = firstInkMedianMs === null || firstInkP95Ms === null ? null
    : firstInkMedianMs <= b.firstInkMedianMs && firstInkP95Ms <= b.firstInkP95Ms;
  return { cases: scores.length, status, row, clusters, ladder, noAnswer, scope, firstInkMedianMs, firstInkP95Ms, qualityPass, timingPass };
}
