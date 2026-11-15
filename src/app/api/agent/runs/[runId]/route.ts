import { AgentRunSchema } from "../../../../../lib/contracts";
import { getRepo } from "../../../../../lib/db";
import { getRunRegistry } from "../../../../../lib/agent";

const headers = { "Cache-Control": "no-store" };

/** A run by id. A run still going is read from the registry, which has its events so far; the store has them at the end. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const live = getRunRegistry().findById(runId);
  if (live) return Response.json(AgentRunSchema.parse(live.snapshot()), { headers });
  try {
    const stored = await getRepo().getRun(runId);
    if (stored) return Response.json(AgentRunSchema.parse(stored), { headers });
  } catch { /* no store in this mode */ }
  return Response.json({ code: "not_found", message: "Run not found." }, { status: 404, headers });
}
