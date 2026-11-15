import { z } from "zod";
import { getRepo } from "../../../../lib/db";
import { seedDemoHistory } from "../../../../lib/progress/demo-history";

// Test setup for the progress pages. Unavailable in production and against Mongo, like the other dev routes.
const enabled = () => process.env.NODE_ENV !== "production" && process.env.STORE === "memory" && process.env.MOCK_LLM === "1";
const Body = z.discriminatedUnion("action", [
  // Hand-written demo history, re-keyed under `courseId` so shared calc2 data is untouched.
  z.object({ action: z.literal("seed"), courseId: z.string().min(1), history: z.boolean().default(true) }),
]);

export async function POST(request: Request) {
  if (!enabled()) return new Response(null, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const body = parsed.data;
  const result = await seedDemoHistory(getRepo(), { courseId: body.courseId, history: body.history });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
