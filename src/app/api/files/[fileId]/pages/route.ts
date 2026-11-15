import { getRepo } from "../../../../../lib/db";
import { sourceErrorResponse } from "../../../../../lib/lms/adapter";
import { filePages } from "../../../../../lib/lms/pdf-files";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await context.params;
    return Response.json(await filePages(getRepo(), fileId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return sourceErrorResponse(error); }
}
