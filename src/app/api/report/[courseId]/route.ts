import { getRepo } from "../../../../lib/db";
import { buildTutorReport, reportPeriod } from "../../../../lib/progress/report";

// Tutor-facing: this reply carries each hint's private note. Never link it from a student page.
export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await context.params;
  const repo = getRepo();
  if (!(await repo.getCourse(courseId)) && !(await repo.listCards(courseId)).length) return new Response(null, { status: 404 });
  const studentId = process.env.DEMO_STUDENT_ID?.trim() || "demo";
  const report = await buildTutorReport(studentId, courseId, reportPeriod(new Date()), repo, { studentName: process.env.DEMO_STUDENT_NAME?.trim() || "Ada" });
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
