import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the repository's hand-written agent instructions.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // The course agent (deepagents, LangChain, native canvas for PDF pages) runs from Node, not the bundler.
  serverExternalPackages: ["deepagents", "langchain", "@langchain/core", "@langchain/langgraph", "@langchain/langgraph-checkpoint-mongodb", "langsmith", "@napi-rs/canvas", "ws"],
};

export default nextConfig;
