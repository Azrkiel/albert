export async function GET() {
  return Response.json({
    db: false,
    llm: process.env.MOCK_LLM === "1" ? false : await (await import("../../../lib/llm")).modelHealth(),
    courseSource: null,
    provider: process.env.LLM_PROVIDER || "bedrock",
    store: process.env.STORE || "mongo",
  });
}
