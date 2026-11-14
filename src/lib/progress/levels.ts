import type { EvidenceEvent, SkillLevel, SkillState, StoredHint, TeachingCard } from "@/lib/contracts";
const millis = (at: string) => Date.parse(at);
const positive = (e: EvidenceEvent) => e.outcome.includes("correct");
const supported = (e: EvidenceEvent) => positive(e) && e.outcome !== "correct_after_r3";
const failure = (e: EvidenceEvent) => e.outcome === "error_made" || e.outcome === "abandoned";
const order = (a: EvidenceEvent, b: EvidenceEvent) => millis(a.at) - millis(b.at) || a.id.localeCompare(b.id);
const hintTime = (e: EvidenceEvent) => e.outcome === "error_made" || Boolean(e.hintId) || e.outcome.startsWith("correct_after_");
const distinct = (a: EvidenceEvent, b: EvidenceEvent) => a.problemId !== b.problemId;

/** Whole history, with explicit hint history when available (including non-error hints). */
export function computeLevel(events: EvidenceEvent[], unitTaught: boolean, hints?: StoredHint[]): { level: SkillLevel; evidenceIds: string[] } {
  if (!unitTaught) return { level: 0, evidenceIds: [] };
  const sorted = [...new Map(events.map(e => [e.id, e])).values()].sort(order);
  const positives = sorted.filter(positive);
  let level: SkillLevel = positives.length ? 2 : 1;
  let evidenceIds = positives.slice(-1).map(e => e.id);
  const candidates = sorted.filter(supported);
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    const b = candidates.slice(i + 1).find(b => distinct(a, b));
    if (b) { level = 3; evidenceIds = [a.id, b.id]; break; }
  }
  const cold = (e: EvidenceEvent) => {
    if (positives.some(p => p.sessionId !== e.sessionId && millis(p.at) < millis(e.at))) return true;
    const near = (at: string) => millis(at) <= millis(e.at) && millis(e.at) - millis(at) <= 20 * 60 * 1000;
    return hints === undefined
      ? !sorted.some(h => h.id !== e.id && hintTime(h) && near(h.at))
      : !hints.some(h => h.diagnose.subskillId === e.subskillId && near(h.at));
  };
  const unaided = positives.filter(e => e.outcome === "unaided_correct");
  for (let i = 0; i < unaided.length; i++) {
    const a = unaided[i]!;
    const b = unaided.slice(i + 1).find(b => distinct(a, b) && (cold(a) || cold(b)));
    if (b) { level = 4; evidenceIds = [a.id, b.id]; break; }
  }
  const last = sorted.slice(-2);
  if (last.length === 2 && last.every(failure)) {
    level = Math.max(1, level - 1) as SkillLevel;
    evidenceIds = [...new Set([...evidenceIds, ...last.map(e => e.id)])];
  }
  return { level, evidenceIds };
}

export function computeSkills(args: { cards: TeachingCard[]; evidence: EvidenceEvent[]; studentId: string; courseId: string; hints?: StoredHint[]; at?: string }): SkillState[] {
  const evidence = args.evidence.filter(e => e.studentId === args.studentId && e.courseId === args.courseId);
  // No clock in pure logic. Unobserved histories have a stable epoch timestamp.
  const updatedAt = args.at ?? [...evidence].sort(order).at(-1)?.at ?? "1970-01-01T00:00:00.000Z";
  return args.cards.filter(c => c.courseId === args.courseId).sort((a, b) => a.order - b.order || a.unitId.localeCompare(b.unitId)).flatMap(card =>
    [...card.subskills].sort((a, b) => a.id.localeCompare(b.id)).map(skill => {
      const events = evidence.filter(e => e.subskillId === skill.id);
      const recentErrorTypes = [...new Set([...events].sort(order).reverse().flatMap(e => e.outcome === "error_made" && e.errorType ? [e.errorType] : []))].slice(0, 3);
      return { studentId: args.studentId, courseId: args.courseId, unitId: card.unitId, subskillId: skill.id,
        ...computeLevel(events, card.taught, args.hints?.filter(h => h.courseId === args.courseId)), recentErrorTypes, updatedAt };
    }));
}
