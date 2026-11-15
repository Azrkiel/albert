import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the repository's hand-written agent instructions.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Keep the course agent, native canvas addon and PDF.js's relative worker import in Node.
  serverExternalPackages: ["deepagents", "langchain", "@langchain/core", "@langchain/langgraph", "@langchain/langgraph-checkpoint-mongodb", "langsmith", "@napi-rs/canvas", "ws", "pdfjs-dist"],
};

export default nextConfig;
