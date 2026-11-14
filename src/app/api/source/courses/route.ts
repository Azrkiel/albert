import { getRepo } from "../../../../lib/db";
import { sourceErrorResponse } from "../../../../lib/lms";

export async function GET() {
  try {
    const repo = getRepo();
    const connection = await repo.getConnection(process.env.DEMO_STUDENT_ID || "demo");
    const course = connection ? await repo.getCourse(connection.courseId) : null;
    return Response.json(course ? [{ id: course.id, title: course.title, ...(course.shortName === undefined ? {} : { shortName: course.shortName }), ingested: Boolean(course.ingestedAt) }] : [], { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return sourceErrorResponse(error); }
}
