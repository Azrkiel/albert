import type { Repo, Session, StoredHint, CheckResponse, Worksheet, SessionEvent } from "@/lib/contracts";
import { evidenceFromHint, evidenceFromCheck, evidenceFromSessionEnd } from "./evidence";

async function context(repo: Repo, session: Session, at: string) {
  const [cards, evidence] = await Promise.all([repo.listCards(session.courseId), repo.listEvidence(session.studentId, session.courseId)]);
  return { ...session, at, evidence, subskillIds: cards.flatMap(c => c.subskills.map(s => s.id)) };
}
export async function recordHintEvidence(repo: Repo, hint: StoredHint, session: Session) {
  const ctx = await context(repo, session, hint.at);
  await repo.saveHint(hint);
  if (hint.diagnose.subskillId && !ctx.subskillIds.includes(hint.diagnose.subskillId)) console.warn("Unknown hint subskill", hint.diagnose.subskillId);
  const events = evidenceFromHint(hint, ctx);
  await repo.addEvidence(events);
  return events;
}
export async function recordCheckEvidence(repo: Repo, check: CheckResponse, problem: Worksheet["problems"][number], session: Session, at: string) {
  const events = evidenceFromCheck(check, problem, await repo.listHints({ sessionId: session.id }), await context(repo, session, at));
  await repo.addEvidence(events);
  return events;
}
export async function recordSessionEndEvidence(repo: Repo, session: Session, checks: SessionEvent[], at: string) {
  const events = evidenceFromSessionEnd(await context(repo, session, at), await repo.listHints({ sessionId: session.id }), checks);
  await repo.addEvidence(events);
  return events;
}
