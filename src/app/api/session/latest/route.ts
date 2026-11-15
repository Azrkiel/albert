import { z } from "zod";
import { SessionSchema, SessionEventSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";

const Query = z.object({ worksheetId: z.string().min(1), fileId: z.string().min(1).optional() });
const Reply = z.object({ session: SessionSchema.nullable(), events: z.array(SessionEventSchema) });
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Expected worksheetId and optional fileId." }, { status: 400, headers });
  try {
    const repo = getRepo();
    const { worksheetId, fileId } = parsed.data;
    const session = await repo.latestOpenSession(worksheetId, fileId === undefined ? undefined
      : { studentId: process.env.DEMO_STUDENT_ID || "demo", fileId });
    if (!session && fileId === undefined) return Response.json({ error: "No open session for this worksheet." }, { status: 404, headers });
    const events = session ? await repo.listEvents(session.id) : [];
    return Response.json(Reply.parse({ session, events }), { headers });
  } catch {
    return Response.json({ error: "Could not load your saved session." }, { status: 500, headers });
  }
}
