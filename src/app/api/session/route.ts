import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SessionSchema, type Session } from "../../../lib/contracts";
import { getRepo } from "../../../lib/db";

// POST handlers are dynamic and use Node by default. cacheComponents forbids
// explicit runtime/dynamic route config in this app.
const headers = { "Cache-Control": "no-store" };
const Body = z.object({ worksheetId: z.string().min(1), surface: z.literal("pdf").optional(), fileId: z.string().min(1).optional() })
  .refine(s => (s.surface === "pdf") === (s.fileId !== undefined), "PDF sessions require both surface and fileId");
const Reply = z.object({ sessionId: z.string() });

export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "Expected { worksheetId }." }, { status: 400, headers });
  }
  try {
    const { worksheetId, surface, fileId } = body;
    const repo = getRepo();
    // The demo has one student, and Phase 5 worksheets carry their course. Until a worksheet is stored the
    // course is the demo course.
    const worksheet = await repo.getWorksheet(worksheetId);
    const session: Session = SessionSchema.parse({
      id: randomUUID(),
      studentId: process.env.DEMO_STUDENT_ID || "demo",
      courseId: worksheet?.courseId ?? "demo",
      worksheetId,
      startedAt: new Date().toISOString(),
      ...(surface ? { surface, fileId } : {}),
    });
    await repo.createSession(session);
    return Response.json(Reply.parse({ sessionId: session.id }), { headers });
  } catch {
    return Response.json({ error: "Could not start the session." }, { status: 500, headers });
  }
}
