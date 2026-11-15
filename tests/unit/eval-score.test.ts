import { describe, expect, it } from "vitest";
import type { EvalCase, HintEvent, HintRequest } from "../../src/lib/contracts";
import { normaliseLatex, percentile, scoreCase, totals, type CaseScore } from "../../src/lib/tutor/eval-score";

const R = String.raw;
const request = {
  sessionId: "s", worksheetId: "calc2-ws3", problemId: "calc2-ws3/p1", rowId: "calc2-ws3/p1/r3", rung: 1, trigger: "pause",
  image: { marked: "x", width: 2, height: 2 }, history: [],
  rows: [1, 2, 3].map((index) => ({ rowId: `calc2-ws3/p1/r${index}`, index, clusterLabels: [1, 2, 3, 8] })),
} satisfies HintRequest;
const base: EvalCase = {
  id: "c", request: "r.json", worksheetId: "calc2-ws3", problemId: "calc2-ws3/p1", stuckRowIndex: 3, rung: 1,
  expect: { status: ["error"], stuckRowLatex: R`\int \frac{1}{16\sin^2\theta\cdot 4\cos\theta}`, errorRowIndex: 3,
    errorClusterLabels: [2, 8], kind: ["question"], mustNotMention: [R`4\cos\theta\,d\theta`], citationIncludes: "Lecture 9",
    forbiddenMethods: ["partial fractions"] },
};
const stream = (text: string, over: { status?: "error" | "on_track"; clusters?: number[]; latex?: string; inScope?: boolean } = {}): HintEvent[] => [
  { type: "started", hintId: "h", at: 0 },
  { type: "reading", rows: [{ rowId: "calc2-ws3/p1/r3", latex: over.latex ?? R`\int\frac{1}{16\sin^{2}\theta \cdot 4\cos\theta}`, confidence: "high" }] },
  { type: "diagnosis", status: over.status ?? "error", rowId: "calc2-ws3/p1/r3", clusterIds: (over.clusters ?? [2]).map((n) => `calc2-ws3/p1/r3/c${n}`), inScope: over.inScope ?? true },
  { type: "hint", kind: "question", segments: [{ type: "text", text }], citation: { unitId: "calc2/u3", label: "Lecture 9, Step 2" } },
  { type: "done", hintId: "h", ms: { firstEvent: 900, total: 2000 } },
];
const obs = (events: HintEvent[], modelCalls = 1) => ({ events, firstInkMs: 1200, totalMs: 2400, modelCalls });
const plain = { sameReading: null, givesAnswer: false };

describe("P3.4 eval scoring (pure)", () => {
  it("normalises spacing, braces and dfrac", () => {
    expect(normaliseLatex(R`\dfrac{1}{x^{2}} \, dx`)).toBe(normaliseLatex(R`\frac1{x^2}dx`));
  });
  it("scores a good rung-1 hint on every measure", () => {
    const s = scoreCase(base, request, obs(stream("What does dx become?")), plain);
    expect(s).toMatchObject({ read: true, status: true, row: true, clusters: true, ladder: true, noAnswer: true, scope: true, citation: true, kind: true, differs: null });
  });
  it("fails no-answer on a forbidden fragment even if the judge says no, and on a judge yes", () => {
    expect(scoreCase(base, request, obs(stream(R`dx is 4\cos\theta d\theta`)), plain).noAnswer).toBe(false);
    expect(scoreCase(base, request, obs(stream("What does dx become?")), { sameReading: null, givesAnswer: true }).noAnswer).toBe(false);
  });
  it("counts a repair as a ladder miss, and an out-of-scope method as a scope miss", () => {
    expect(scoreCase(base, request, obs(stream("What does dx become?"), 2), plain).ladder).toBe(false);
    expect(scoreCase(base, request, obs(stream("Try partial fractions.")), plain).scope).toBe(false);
  });
  it("uses the reader judgement only when the LaTeX differs", () => {
    const off = stream("q?", { latex: R`\int \frac{1}{16\sin^2\theta}` });
    expect(scoreCase(base, request, obs(off), { sameReading: false, givesAnswer: false }).read).toBe(false);
    expect(scoreCase(base, request, obs(off), { sameReading: true, givesAnswer: false }).read).toBe(true);
  });
  it("wrong clusters and wrong status fail their measures", () => {
    const s = scoreCase(base, request, obs(stream("q?", { clusters: [5], status: "on_track" })), plain);
    expect(s.clusters).toBe(false);
    expect(s.status).toBe(false);
  });
  it("a repeated hint must differ from the last one when nothing was written", () => {
    const repeat: EvalCase = { ...base, history: [{ hintId: "h0", rung: 1, rowId: "calc2-ws3/p1/r3", text: "What does dx become?", studentWroteAfter: false }] };
    expect(scoreCase(repeat, request, obs(stream("What does dx become?")), plain).differs).toBe(false);
    expect(scoreCase(repeat, request, obs(stream("Differentiate x = 4 sin θ.")), plain).differs).toBe(true);
  });
  it("an error stream fails status and ladder", () => {
    const s = scoreCase(base, request, obs([{ type: "started", hintId: "h", at: 0 }, { type: "error", code: "timeout", message: "x" }]), { sameReading: null, givesAnswer: null });
    expect(s).toMatchObject({ status: false, ladder: false, noAnswer: false, error: "timeout" });
  });
  it("totals apply the bars and nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5);
    const good = scoreCase(base, request, obs(stream("What does dx become?")), plain);
    expect(totals([good, good]).qualityPass).toBe(true);
    const leaky: CaseScore = { ...good, noAnswer: false };
    expect(totals([good, leaky]).qualityPass).toBe(false);
    expect(totals([good]).timingPass).toBe(true);
  });
});
