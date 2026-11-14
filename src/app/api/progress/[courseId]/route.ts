import { EvidenceEventSchema, SkillStateSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";
import { recomputeSkills } from "../../../../lib/progress";

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  const studentId = process.env.DEMO_STUDENT_ID || "demo";
  const repo = getRepo();
  const cards = await repo.listCards(courseId);
  if (!cards.length && !await repo.getCourse(courseId)) return new Response(null, { status: 404 });
  const skills = SkillStateSchema.array().parse(await recomputeSkills(studentId, courseId, repo));
  const evidence = EvidenceEventSchema.array().parse(await repo.listEvidence(studentId, courseId));
  const recentErrors = evidence.filter(e => e.outcome === "error_made")
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)).slice(0, 20)
    .map(e => ({ subskillId: e.subskillId, errorType: e.errorType, at: e.at, hintId: e.hintId }));
  return Response.json({ skills, recentErrors }, { headers: { "Cache-Control": "no-store" } });
}
