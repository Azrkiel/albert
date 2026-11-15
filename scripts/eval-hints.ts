// P3.4: score live hints against fixtures/eval/cases. Spends model calls: one hint call per case
// (two when the reply needs its one repair), one reader judge per rung-1/2 case, and one more when
// the transcription differs from the expected LaTeX after normalising.
//   pnpm eval:hints [--case <id>]... [--timing] [--cards ingested --state <memory state json>]
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  CourseOutlineSchema, CourseSchema, EvalCaseSchema, HintRequestSchema, TeachingCardSchema, WorksheetSchema,
  type EvalCase, type HintEvent, type HintRequest, type Repo,
} from "../src/lib/contracts";
import { MemoryRepo, seedDemo } from "../src/lib/db";
import { getChatModel } from "../src/lib/llm";
import { runHint } from "../src/lib/tutor/hint";
import { getHintModel } from "../src/lib/tutor/tools";
import { EVAL_BARS, normaliseLatex, scoreCase, stuckRowReading, totals, type CaseScore, type EvalObservation } from "../src/lib/tutor/eval-score";

/** Our own setup problems; anything else (provider, network) is reported by name only, never its message. */
class EvalSetupError extends Error {}
const safeMessage = (error: unknown) => error instanceof EvalSetupError ? error.message : error instanceof Error ? error.name : "failed";

const root = join(process.cwd(), "fixtures", "eval");
const args = process.argv.slice(2).filter((a) => a !== "--");
const flagValues = (name: string) => args.flatMap((a, i) => a === name && args[i + 1] ? [args[i + 1]!] : []);
const only = flagValues("--case");
const enforceTiming = args.includes("--timing");
const cards = flagValues("--cards")[0];
const statePath = flagValues("--state")[0];

const JudgeSchema = z.object({ answer: z.enum(["yes", "no"]), reason: z.string() });
const judgeTool = { name: "judge", description: "Answer the question with yes or no and one short reason.", schema: JudgeSchema };
const JudgeOutput = z.object({ tool_calls: z.array(z.object({ name: z.literal("judge"), args: JudgeSchema })).length(1) });

let judgeCalls = 0;
async function judge(system: string, question: string): Promise<boolean | null> {
  const model = getChatModel("reader");
  if (!model.bindTools) throw new Error("The reader model must support tools.");
  const bound = model.bindTools([judgeTool], { tool_choice: "judge", maxRetries: 0 });
  judgeCalls++;
  try {
    const parsed = JudgeOutput.safeParse(await bound.invoke([new SystemMessage(system), new HumanMessage(question)]));
    return parsed.success ? parsed.data.tool_calls[0]!.args.answer === "yes" : null;
  } catch { return null; }
}

const StateSchema = z.object({
  course: CourseSchema, outline: CourseOutlineSchema, cards: z.array(TeachingCardSchema), worksheets: z.array(WorksheetSchema),
});

/** Hand-written demo cards by default; `--cards ingested` reads an agent run's saved memory state instead. */
async function openRepo(): Promise<{ repo: Repo; remap: (c: EvalCase, r: HintRequest) => HintRequest }> {
  const repo = new MemoryRepo();
  if (cards !== "ingested") {
    await seedDemo(repo);
    return { repo, remap: (_c, r) => r };
  }
  if (!statePath) throw new EvalSetupError("--cards ingested needs --state <file> from pnpm agent:ingest");
  const state = StateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
  await repo.upsertCourse(state.course);
  await repo.saveOutline(state.outline);
  for (const card of state.cards) await repo.upsertCard(card);
  for (const ws of state.worksheets) await repo.upsertWorksheet(ws);
  const hand = new Map<string, z.infer<typeof WorksheetSchema>>();
  for (const name of (await readdir(join(process.cwd(), "fixtures", "worksheets"))).filter((n) => n.endsWith(".json"))) {
    const ws = WorksheetSchema.parse(JSON.parse(await readFile(join(process.cwd(), "fixtures", "worksheets", name), "utf8")));
    hand.set(ws.id, ws);
  }
  // Map the case's hand-written worksheet to the ingested one with the same worksheet number and problem label.
  return { repo, remap: (c, r) => {
    const original = hand.get(c.worksheetId);
    const number = original?.title.match(/\d+/)?.[0];
    const label = original?.problems.find((p) => p.id === c.problemId)?.label;
    const ws = state.worksheets.find((w) => number !== undefined && new RegExp(`\\b${number}\\b`).test(w.title));
    // Ingested labels may read "Problem 1" where the hand-written worksheet says "1".
    const labelKey = (l: string | undefined) => l?.match(/\d+[a-z]?/i)?.[0]?.toLowerCase();
    const problem = ws?.problems.find((p) => labelKey(p.label) !== undefined && labelKey(p.label) === labelKey(label));
    if (!ws || !problem) throw new EvalSetupError(`No ingested worksheet/problem for ${c.id}`);
    return { ...r, worksheetId: ws.id, problemId: problem.id };
  } };
}

async function runCase(c: EvalCase, repo: Repo, remap: (c: EvalCase, r: HintRequest) => HintRequest) {
  if (!c.request) throw new EvalSetupError(`${c.id}: build a snapshot request first (scripts/build-eval-request.ts); recordings are replayed there`);
  const stored = HintRequestSchema.parse(JSON.parse(await readFile(join(root, "requests", c.request), "utf8")));
  const request = remap(c, { ...stored, rung: c.rung, history: c.history ?? [], ...(c.question === undefined ? {} : { question: c.question }) });
  const bound = getHintModel();
  let modelCalls = 0;
  let repair: string | undefined;
  const events: HintEvent[] = [];
  const start = performance.now();
  let firstInkMs: number | null = null;
  for await (const event of runHint(request, { repo, model: {
    invoke: (messages, options) => {
      modelCalls++;
      // The second call carries runHint's repair note: keep it so a ladder miss explains itself.
      if (modelCalls === 2) { const last = messages.at(-1)?.content; repair = typeof last === "string" ? last.split(/\r?\n/).slice(1).join("; ") : "repair"; }
      return bound.invoke(messages, options);
    },
    dispose: bound.dispose,
  } })) {
    if (firstInkMs === null && (event.type === "mark" || event.type === "hint")) firstInkMs = Math.round(performance.now() - start);
    events.push(event);
  }
  const obs: EvalObservation = { events, firstInkMs, totalMs: Math.round(performance.now() - start), modelCalls };
  const reading = stuckRowReading(events, request, c.stuckRowIndex);
  const expected = c.expect.stuckRowLatex;
  const sameReading = expected !== undefined && reading !== undefined && normaliseLatex(reading) !== normaliseLatex(expected)
    ? await judge("You compare two LaTeX transcriptions of handwritten math. Ignore spacing and notation that does not change the expression.",
      `Are these the same expression?\nA: ${reading}\nB: ${expected}`)
    : null;
  const hint = events.find((e) => e.type === "hint");
  const givesAnswer = c.rung <= 2 && hint && hint.type === "hint"
    ? await judge("You check math tutoring hints. A hint may ask a question or name the next step; it must not do the step for the student.",
      `The student is solving ${JSON.stringify(stored.problemId)} and the problem's next correct line is what they must find.\nHint: ${JSON.stringify(hint.segments)}\nDoes this hint state the corrected step or the final answer?`)
    : null;
  return { ...scoreCase(c, request, obs, { sameReading, givesAnswer }), ...(repair ? { repair } : {}) };
}

const mark = (v: boolean | null) => v === null ? "  -  " : v ? " yes " : " NO  ";
const pct = (v: number | null) => v === null ? "  -  " : `${Math.round(v * 100)}%`.padStart(5);

async function main() {
  const names = (await readdir(join(root, "cases"))).filter((n) => n.endsWith(".json")).sort();
  const cases = (await Promise.all(names.map(async (n) => EvalCaseSchema.parse(JSON.parse(await readFile(join(root, "cases", n), "utf8"))))))
    .filter((c) => only.length === 0 || only.includes(c.id));
  if (!cases.length) throw new EvalSetupError("No eval cases selected.");
  const { repo, remap } = await openRepo();
  const scores: CaseScore[] = [];
  for (const c of cases) {
    try { scores.push(await runCase(c, repo, remap)); }
    catch (error) {
      scores.push({ id: c.id, rung: c.rung, read: null, status: false, row: null, clusters: null, ladder: false, noAnswer: c.rung <= 2 ? false : null,
        scope: false, differs: null, citation: null, kind: null, firstInkMs: null, totalMs: 0, error: safeMessage(error).slice(0, 160) });
    }
  }
  console.log("case                       rung  read status  row  clust ladder noans scope differ cite  kind  ink ms  total ms");
  for (const s of scores) {
    console.log(`${s.id.padEnd(26)} ${String(s.rung).padStart(3)} ${mark(s.read)}${mark(s.status)}${mark(s.row)}${mark(s.clusters)}${mark(s.ladder)}${mark(s.noAnswer)}${mark(s.scope)}${mark(s.differs)}${mark(s.citation)}${mark(s.kind)}${String(s.firstInkMs ?? "-").padStart(7)} ${String(s.totalMs).padStart(9)}${s.error ? `  error: ${s.error}` : ""}`);
    if (s.hint) console.log(`    hint: ${s.hint}`);
    if (s.repair) console.log(`    repair: ${s.repair.slice(0, 200)}`);
  }
  const t = totals(scores);
  console.log(`\nTotals (${t.cases} cases): status ${pct(t.status)} (bar ${EVAL_BARS.status * 100}%) · row ${pct(t.row)} · clusters ${pct(t.clusters)} · ladder ${pct(t.ladder)} · no-answer ${pct(t.noAnswer)} · scope ${pct(t.scope)}`);
  console.log(`First ink: median ${t.firstInkMedianMs ?? "-"} ms, p95 ${t.firstInkP95Ms ?? "-"} ms (bars ${EVAL_BARS.firstInkMedianMs}/${EVAL_BARS.firstInkP95Ms} ms, ${enforceTiming ? "enforced" : "checked after P3.6"})`);
  console.log(`Quality bar: ${t.qualityPass ? "PASS" : "MISSED"}${enforceTiming ? ` · timing bar: ${t.timingPass ? "PASS" : "MISSED"}` : ""} · judge calls ${judgeCalls}`);
  await writeFile(join(root, "last-run.json"), JSON.stringify({ at: new Date().toISOString(), cards: cards ?? "hand", model: process.env.HINT_MODEL_ID, scores, totals: t, judgeCalls }, null, 2) + "\n");
  if (!t.qualityPass || (enforceTiming && !t.timingPass)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`eval:hints failed: ${safeMessage(error).slice(0, 200)}`);
  process.exitCode = 1;
});
