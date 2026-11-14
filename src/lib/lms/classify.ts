import type { CourseFile } from "../contracts";

export function guessKind(title: string, mime: string): CourseFile["kind"] {
  if (/lecture|notes/i.test(title)) return "lecture_notes";
  if (/worksheet|problem set|homework|\bhw\b|assignment/i.test(title)) return "worksheet";
  if (/syllabus/i.test(title)) return "syllabus";
  if (/slides/i.test(title) || /presentation|powerpoint/i.test(mime)) return "slides";
  return "other";
}
