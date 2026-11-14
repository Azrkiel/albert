import { getRepo } from "../../../../lib/db";
import { CourseSourceError, sourceErrorResponse } from "../../../../lib/lms";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    // Next decodes route params once; file ids themselves may contain encoded path segments.
    const { fileId } = await context.params;
    const file = await getRepo().getFile(fileId);
    if (!file) throw new CourseSourceError("not_found");
    return new Response(new Uint8Array(file.bytes), { headers: {
      "Content-Type": file.meta.mime, "Content-Length": String(file.bytes.length),
      "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } });
  } catch (error) { return sourceErrorResponse(error); }
}
