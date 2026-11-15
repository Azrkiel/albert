import { WorksheetSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";
import { CourseSourceError, sourceErrorResponse } from "../../../../lib/lms/adapter";
import { worksheetWithRegions } from "../../../../lib/lms/pdf-files";

const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ worksheetId: string }> }) {
  try {
    const { worksheetId } = await context.params;
    const repo = getRepo();
    const worksheet = await repo.getWorksheet(worksheetId);
    if (!worksheet) return Response.json({ error: "not_found", message: "No such worksheet." }, { status: 404, headers });
    const enriched = await worksheetWithRegions(repo, WorksheetSchema.parse(worksheet));
    return Response.json(WorksheetSchema.parse(enriched), { headers });
  } catch (error) {
    if (error instanceof CourseSourceError) return sourceErrorResponse(error);
    return Response.json({ error: "server_error", message: "Could not load the worksheet." }, { status: 500, headers });
  }
}
