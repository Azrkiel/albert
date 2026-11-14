import type { Repo } from "../contracts";
import { getRepo } from "../db";
import { computeSkills } from "./levels";
export { computeLevel, computeSkills } from "./levels";

export async function recomputeSkills(studentId: string, courseId: string, repo: Repo = getRepo(), at = new Date().toISOString()) {
  const [cards, evidence, courseHints, worksheets] = await Promise.all([repo.listCards(courseId), repo.listEvidence(studentId, courseId), repo.listHints({ courseId }), repo.listWorksheets(courseId)]);
  const sessions = await Promise.all([...new Set(courseHints.map(h => h.sessionId))].map(id => repo.getSession(id)));
  const owned = new Set(sessions.filter(s => s?.studentId === studentId && s.courseId === courseId).map(s => s!.id));
  // A non-error hint may omit subskillId. For timing only, its problem tags
  // identify the skills helped; never change the stored model diagnosis.
  const hints = courseHints.filter(h => owned.has(h.sessionId)).flatMap(h => {
    if (h.diagnose.subskillId) return [h];
    const ids = worksheets.flatMap(w => w.problems).find(p => p.id === h.problemId)?.subskillIds ?? [];
    return ids.map(subskillId => ({ ...h, diagnose: { ...h.diagnose, subskillId } }));
  });
  const skills = computeSkills({ cards, evidence, studentId, courseId, hints, at });
  await repo.saveSkills(skills);
  return skills;
}
