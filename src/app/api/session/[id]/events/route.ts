import { z } from "zod";
import { SessionEventSchema } from "../../../../../lib/contracts";
import { getRepo } from "../../../../../lib/db";

const headers = { "Cache-Control": "no-store" };
const Body = z.object({ events: z.array(SessionEventSchema) });
const Reply = z.object({ ok: z.literal(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let events;
  try {
    events = Body.parse(await request.json()).events;
  } catch {
    return Response.json({ error: "Expected { events: SessionEvent[] }." }, { status: 400, headers });
  }
  try {
    await getRepo().appendEvents(id, events);
    return Response.json(Reply.parse({ ok: true }), { headers });
  } catch (error) {
    const missing = error instanceof Error && error.message.startsWith("Session not found");
    return Response.json({ error: missing ? "Session not found." : "Could not save events." }, { status: missing ? 404 : 500, headers });
  }
}
