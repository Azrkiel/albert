import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/health/route";

beforeEach(() => vi.stubEnv("MONGODB_URI", ""));
afterEach(() => vi.unstubAllEnvs());

it("reports the P1.3 placeholders and documented defaults", async () => {
  vi.stubEnv("LLM_PROVIDER", undefined);
  vi.stubEnv("STORE", undefined);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    db: false, llm: false, courseSource: null, provider: "bedrock", store: "mongo",
  });
});

it("reports the configured provider and a healthy memory store", async () => {
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("STORE", "memory");
  expect(await (await GET()).json()).toEqual({
    db: true, llm: false, courseSource: null, provider: "anthropic", store: "memory",
  });
});

it("uses defaults for the blank values in .env.example", async () => {
  vi.stubEnv("LLM_PROVIDER", "");
  vi.stubEnv("STORE", "");
  expect(await (await GET()).json()).toEqual({
    db: false, llm: false, courseSource: null, provider: "bedrock", store: "mongo",
  });
});
