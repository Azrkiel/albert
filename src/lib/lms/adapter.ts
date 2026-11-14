export type { CourseSourceAdapter } from "../contracts";

export type CourseSourceErrorCode = "not_found" | "forbidden" | "rate_limited" | "unavailable" | "bad_reply";
const messages: Record<CourseSourceErrorCode, string> = {
  not_found: "The course source or cached file was not found.",
  forbidden: "GitHub refused access to this course source.",
  rate_limited: "GitHub's request limit was reached. Try again later.",
  unavailable: "The course source is unavailable. Try again later.",
  bad_reply: "The course source contains an invalid manifest or PDF.",
};

/** Deliberately excludes upstream messages, response bodies and credential-bearing URLs. */
export class CourseSourceError extends Error {
  constructor(readonly code: CourseSourceErrorCode) {
    super(messages[code]);
    this.name = "CourseSourceError";
  }
}

export function sourceErrorResponse(error: unknown): Response {
  const safe = error instanceof CourseSourceError ? error : new CourseSourceError("unavailable");
  const status: Record<CourseSourceErrorCode, number> = { not_found: 404, forbidden: 403, rate_limited: 429, unavailable: 503, bad_reply: 502 };
  return Response.json({ code: safe.code, message: safe.message }, { status: status[safe.code], headers: { "Cache-Control": "no-store" } });
}
