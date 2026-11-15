import { WorksheetSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";
import { CourseSourceError, sourceErrorResponse } from "../../../../lib/lms/adapter";
import { worksheetWithRegions } from "../../../../lib/lms/pdf-files";

export async function GET(_request: Request, context: { params: Promise<{ worksheetId: string }> }) {
  try {
    const { worksheetId } = await context.params;
    const repo = getRepo();
    const worksheet = await repo.getWorksheet(worksheetId);
    if (!worksheet) throw new CourseSourceError("not_found");
    const enriched = await worksheetWithRegions(repo, WorksheetSchema.parse(worksheet));
    return Response.json(WorksheetSchema.parse(enriched), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return sourceErrorResponse(error); }
}
