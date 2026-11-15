import { getRepo } from "../../../../lib/db";

const headers = { "Cache-Control": "no-store" };

/** What the course has learned so far: card count and the worksheets, for the Learn panel. */
export async function GET(request: Request) {
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId) return Response.json({ code: "bad_request", message: "Expected ?courseId=." }, { status: 400, headers });
  try {
    const repo = getRepo();
    const [cards, worksheets] = await Promise.all([repo.listCards(courseId), repo.listWorksheets(courseId)]);
    return Response.json({ cards: cards.length, worksheets: worksheets.map((w) => ({ id: w.id, title: w.title })) }, { headers });
  } catch { return Response.json({ code: "unavailable", message: "Could not read the course." }, { status: 503, headers }); }
}
