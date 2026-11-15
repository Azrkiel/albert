import { z } from "zod";
import { SessionEventSchema, SessionSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";

const headers = { "Cache-Control": "no-store" };
const Query = z.object({ worksheetId: z.string().min(1) });
const Reply = z.object({ session: SessionSchema, events: z.array(SessionEventSchema) });

/** R2.3: the worksheet's latest open session with its events in order, so the canvas can replay it on open. */
export async function GET(request: Request) {
  const query = Query.safeParse({ worksheetId: new URL(request.url).searchParams.get("worksheetId") ?? undefined });
  if (!query.success) return Response.json({ error: "Expected ?worksheetId=." }, { status: 400, headers });
  try {
    const repo = getRepo();
    const session = await repo.latestOpenSession(query.data.worksheetId);
    if (!session) return Response.json({ error: "No open session for this worksheet." }, { status: 404, headers });
    return Response.json(Reply.parse({ session, events: await repo.listEvents(session.id) }), { headers });
  } catch {
    return Response.json({ error: "Could not load the session." }, { status: 500, headers });
  }
}
