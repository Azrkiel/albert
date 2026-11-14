import { z } from "zod";
import { getRepo } from "../../../../../lib/db";

const headers = { "Cache-Control": "no-store" };
// Phase 7 adds evidence and re-planning here; until then nothing is derived.
const Reply = z.object({ evidenceAdded: z.number().int().nonnegative(), replanRunId: z.string().optional() });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await getRepo().endSession(id, new Date().toISOString());
    return Response.json(Reply.parse({ evidenceAdded: 0 }), { headers });
  } catch (error) {
    const missing = error instanceof Error && error.message.startsWith("Session not found");
    return Response.json({ error: missing ? "Session not found." : "Could not end the session." }, { status: missing ? 404 : 500, headers });
  }
}
