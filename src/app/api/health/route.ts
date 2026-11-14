import { getRepo } from "../../../lib/db";

export async function GET() {
  let db = false;
  try { db = await getRepo().ping(); } catch { /* Missing or invalid database configuration. */ }
  return Response.json({
    db,
    // Offline mode never loads the model SDKs; otherwise use the 60-second cached model ping.
    llm: process.env.MOCK_LLM === "1" ? false : await (await import("../../../lib/llm")).modelHealth(),
    courseSource: null,
    provider: process.env.LLM_PROVIDER || "bedrock",
    store: process.env.STORE || "mongo",
  });
}
