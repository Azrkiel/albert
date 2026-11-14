import { ScopeBundleSchema } from "../../../../lib/contracts";
import { getScopeBundle, ScopeNotFoundError } from "../../../../lib/tutor/scope";

// GET is dynamic and uses Node by default. cacheComponents forbids explicit runtime/dynamic route config.
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ worksheetId: string }> }) {
  const { worksheetId } = await context.params;
  const problemId = new URL(request.url).searchParams.get("problemId");
  if (!problemId) return Response.json({ error: "bad_request", message: "problemId query parameter is required." }, { status: 400, headers });
  try {
    return Response.json(ScopeBundleSchema.parse(await getScopeBundle(worksheetId, problemId)), { headers });
  } catch (error) {
    if (error instanceof ScopeNotFoundError) return Response.json({ error: "not_found", message: error.message }, { status: 404, headers });
    return Response.json({ error: "server_error", message: "Could not build the scope bundle." }, { status: 500, headers });
  }
}
