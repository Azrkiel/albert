import { getRepo } from "../../../../lib/db";
import { configuredGitHubSource, importGitHubCourse, sourceErrorResponse } from "../../../../lib/lms";

export async function POST() {
  try {
    const course = await importGitHubCourse(getRepo(), configuredGitHubSource());
    return Response.json({ courseId: course.id, title: course.title, commitSha: course.snapshot!.commitSha }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return sourceErrorResponse(error); }
}
