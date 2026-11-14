"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { CourseSchema } from "@/lib/contracts";
// The error module has no server dependencies. The lms barrel also loads the Repo.
import { CourseSourceError } from "@/lib/lms/adapter";

const coursesSchema = z.array(z.object({
  id: CourseSchema.shape.id.min(1),
  title: CourseSchema.shape.title.min(1),
  shortName: CourseSchema.shape.shortName,
  ingested: z.boolean(),
}));

export async function readSourceResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (response.ok) return body;
  const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
  switch (code) {
    case "not_found":
    case "forbidden":
    case "rate_limited":
    case "unavailable":
    case "bad_reply":
      throw new CourseSourceError(code);
    default:
      throw new CourseSourceError("unavailable");
  }
}

export function sourceMessage(error: unknown): string {
  return error instanceof CourseSourceError
    ? error.message : new CourseSourceError("unavailable").message;
}

export function useSourceCourses() {
  const [courses, setCourses] = useState<z.infer<typeof coursesSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/source/courses", { cache: "no-store", signal: controller.signal });
        const parsed = coursesSchema.safeParse(await readSourceResponse(response));
        if (!parsed.success) throw new CourseSourceError("bad_reply");
        if (!controller.signal.aborted) setCourses(parsed.data);
      } catch (error) {
        if (!controller.signal.aborted) setError(sourceMessage(error));
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return { courses, error };
}
