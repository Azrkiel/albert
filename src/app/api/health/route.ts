import { getRepo } from "../../../lib/db";

export async function GET() {
  let db = false;
  try { db = await getRepo().ping(); } catch { /* Missing or invalid database configuration. */ }
  return Response.json({
    db,
    llm: false,
    courseSource: null,
    provider: process.env.LLM_PROVIDER || "bedrock",
    store: process.env.STORE || "mongo",
  });
}
