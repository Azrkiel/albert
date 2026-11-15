import { z } from "zod";
import { SessionSchema, SessionEventSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";

const Query = z.object({ worksheetId: z.string().min(1), fileId: z.string().min(1) });
const Reply = z.object({ session: SessionSchema.nullable(), events: z.array(SessionEventSchema) });
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Expected worksheetId and fileId." }, { status: 400, headers });
  try {
    const repo = getRepo();
    const session = await repo.latestOpenSession(process.env.DEMO_STUDENT_ID || "demo", parsed.data.worksheetId, parsed.data.fileId);
    const events = session ? await repo.listEvents(session.id) : [];
    return Response.json(Reply.parse({ session, events }), { headers });
  } catch {
    return Response.json({ error: "Could not load your saved session." }, { status: 500, headers });
  }
}
