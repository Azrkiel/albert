import { z } from "zod";
import { SessionEventSchema } from "../../../../lib/contracts";
import { getRepo } from "../../../../lib/db";

const Reply = z.object({ events: z.array(SessionEventSchema) });

/** Dev-only read-back of a session's stored events, in order (P2.8-AC1). */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing session id", { status: 400 });
  return Response.json(Reply.parse({ events: await getRepo().listEvents(id) }), { headers: { "Cache-Control": "no-store" } });
}
