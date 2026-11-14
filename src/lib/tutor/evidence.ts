import type { CheckResponse, EvidenceEvent, Session, SessionEvent, StoredHint, Worksheet } from "@/lib/contracts";

// Callers supply history, course membership and time. No storage or clock here.
export type EvidenceContext = Session & { subskillIds: string[]; evidence: EvidenceEvent[]; at: string };
const key = (parts: string[]) => JSON.stringify(parts);
function event(session: EvidenceContext, problemId: string, subskillId: string, outcome: EvidenceEvent["outcome"], discriminator = ""): EvidenceEvent {
  return { id: key([session.id, problemId, subskillId, outcome, discriminator]), studentId: session.studentId,
    courseId: session.courseId, sessionId: session.id, problemId, subskillId, outcome, at: session.at };
}
function known(id: string, session: EvidenceContext): boolean {
  return session.subskillIds.includes(id);
}
const fresh = (events: EvidenceEvent[], session: EvidenceContext) => events.filter(e => !session.evidence.some(old =>
  old.id === e.id || (old.studentId === e.studentId && old.courseId === e.courseId && old.sessionId === e.sessionId &&
    old.problemId === e.problemId && old.subskillId === e.subskillId && old.outcome === e.outcome && old.errorType === e.errorType)));
const belongs = (hint: StoredHint, session: Session) => hint.sessionId === session.id && hint.courseId === session.courseId;

export function evidenceFromHint(hint: StoredHint, session: EvidenceContext): EvidenceEvent[] {
  const { status, subskillId, errorType } = hint.diagnose;
  if (!belongs(hint, session) || status !== "error" || !subskillId) return [];
  if (!known(subskillId, session)) return [];
  // Identity is independent of rung, hint id and retry time.
  return fresh([{ ...event(session, hint.problemId, subskillId, "error_made", errorType), at: hint.at, errorType, hintId: hint.id }], session);
}

export function evidenceFromCheck(check: CheckResponse, problem: Worksheet["problems"][number], hintsOnProblem: StoredHint[], session: EvidenceContext): EvidenceEvent[] {
  if (check.verdict !== "correct") return [];
  const hints = hintsOnProblem.filter(h => belongs(h, session) && h.problemId === problem.id);
  const rung = Math.max(0, ...hints.map(h => h.rung));
  const outcome = rung === 0 ? "unaided_correct" : rung === 1 ? "correct_after_r1" : rung === 2 ? "correct_after_r2" : "correct_after_r3";
  // Rechecking one problem is not another independent solve.
  return [...new Set(problem.subskillIds)].filter(id => known(id, session)).flatMap(id =>
    session.evidence.some(e => e.sessionId === session.id && e.problemId === problem.id && e.subskillId === id && e.outcome.includes("correct"))
      ? [] : [event(session, problem.id, id, outcome)]);
}

export function evidenceFromSessionEnd(session: EvidenceContext, hints: StoredHint[], checks: SessionEvent[]): EvidenceEvent[] {
  const solved = new Set(checks.filter(e => e.type === "check_result" && e.verdict === "correct").map(e => "problemId" in e ? e.problemId : ""));
  const result = new Map<string, EvidenceEvent>();
  for (const hint of hints) {
    const id = hint.diagnose.subskillId;
    if (!belongs(hint, session) || hint.diagnose.status !== "error" || !id || !known(id, session) || solved.has(hint.problemId)) continue;
    const e = event(session, hint.problemId, id, "abandoned");
    result.set(e.id, e);
  }
  return fresh([...result.values()], session);
}
