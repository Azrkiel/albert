import { z } from "zod";
import { SessionSchema, TeachingCardSchema, WorksheetSchema, EvidenceEventSchema } from "@/lib/contracts";
import { getRepo } from "@/lib/db";
const enabled = () => process.env.NODE_ENV !== "production" && process.env.STORE === "memory" && process.env.MOCK_LLM === "1";
// Test setup stays unavailable in production and against Mongo.
export async function POST(request: Request) {
  if (!enabled()) return new Response(null, { status: 404 });
  const parsed = z.object({ session: SessionSchema, card: TeachingCardSchema, worksheet: WorksheetSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { session, card, worksheet } = parsed.data;
  if (session.courseId !== card.courseId || worksheet.courseId !== card.courseId || session.worksheetId !== worksheet.id) return new Response(null, { status: 400 });
  const repo = getRepo();
  await repo.upsertCard(card);
  await repo.upsertWorksheet(worksheet);
  await repo.createSession(session);
  return Response.json({ ok: true });
}
export async function GET(request: Request) {
  if (!enabled()) return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const events = await getRepo().listEvidence(params.get("studentId") ?? "demo", params.get("courseId") ?? "");
  return Response.json(EvidenceEventSchema.array().parse(events), { headers: { "Cache-Control": "no-store" } });
}
