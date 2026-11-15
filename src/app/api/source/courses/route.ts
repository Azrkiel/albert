import { connection } from "next/server";
import { getRepo } from "../../../../lib/db";
import { sourceErrorResponse } from "../../../../lib/lms";

export async function GET() {
  // Read the store per request: without this, Cache Components prerenders the empty list at build time.
  await connection();
  try {
    const repo = getRepo();
    const connection = await repo.getConnection(process.env.DEMO_STUDENT_ID || "demo");
    const course = connection ? await repo.getCourse(connection.courseId) : null;
    return Response.json(course ? [{ id: course.id, title: course.title, ...(course.shortName === undefined ? {} : { shortName: course.shortName }), ingested: Boolean(course.ingestedAt) }] : [], { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return sourceErrorResponse(error); }
}
