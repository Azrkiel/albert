import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the repository's hand-written agent instructions.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
