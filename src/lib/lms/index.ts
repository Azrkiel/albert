import { getRepo } from "../db";
import type { CourseSourceAdapter, Repo } from "../contracts";
import { CourseSourceError } from "./adapter";
import { GitHubAdapter } from "./github";

export { CourseSourceError, sourceErrorResponse } from "./adapter";
export type { CourseSourceAdapter, CourseSourceErrorCode } from "./adapter";
export { configuredGitHubSource, GitHubAdapter, importGitHubCourse } from "./github";
export { guessKind } from "./classify";
export { filePages, filePagePng, worksheetWithRegions } from "./pdf-files";
export { regionsFromText } from "./regions";

export async function getAdapter(courseId: string, repo: Repo = getRepo()): Promise<CourseSourceAdapter> {
  const course = await repo.getCourse(courseId);
  if (!course) throw new CourseSourceError("not_found");
  if (course.source === "github") return new GitHubAdapter(repo, courseId);
  throw new CourseSourceError("unavailable"); // P5.4 supplies UploadAdapter.
}
