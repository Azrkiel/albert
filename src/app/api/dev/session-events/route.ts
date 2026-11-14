import { z } from "zod";
import { SessionEventSchema } from "../../../../lib/contracts";
import { getRepo, MemoryRepo } from "../../../../lib/db";

const Reply = z.object({ events: z.array(SessionEventSchema) });

/** Dev-only read-back of a session's stored events, in the order they were stored (P2.8-AC1). */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing session id", { status: 400 });
  const repo = getRepo();
  // The Repo contract has no read-back for events; only the in-memory store exposes them.
  if (!(repo instanceof MemoryRepo)) return new Response("Read-back needs STORE=memory", { status: 501 });
  return Response.json(Reply.parse({ events: await repo.listEvents(id) }), { headers: { "Cache-Control": "no-store" } });
}
