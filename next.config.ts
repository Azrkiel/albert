import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve the repository's hand-written agent instructions.
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Keep the native canvas addon and PDF.js's relative worker import in Node.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
