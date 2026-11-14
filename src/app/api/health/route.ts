export function GET() {
  return Response.json({
    db: false,
    llm: false,
    courseSource: null,
    provider: process.env.LLM_PROVIDER || "bedrock",
    store: process.env.STORE || "mongo",
  });
}
