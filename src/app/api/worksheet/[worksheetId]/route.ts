import { WorksheetSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";

// GET is dynamic and uses Node by default. cacheComponents forbids explicit runtime/dynamic route config.
const headers = { "Cache-Control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ worksheetId: string }> }) {
  const { worksheetId } = await context.params;
  try {
    const worksheet = await getRepo().getWorksheet(worksheetId);
    if (!worksheet) return Response.json({ error: "not_found", message: "No such worksheet." }, { status: 404, headers });
    return Response.json(WorksheetSchema.parse(worksheet), { headers });
  } catch {
    return Response.json({ error: "server_error", message: "Could not load the worksheet." }, { status: 500, headers });
  }
}
