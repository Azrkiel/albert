import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev --hostname localhost --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: { MOCK_LLM: "1", STORE: "memory", LLM_PROVIDER: "bedrock" },
  },
});
