import { readFileSync } from "node:fs";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const invoke = vi.fn();
  const model = { invoke };
  return {
    invoke, model,
    bedrock: vi.fn<(options: Record<string, unknown>) => typeof model>(function () { return model; }),
    anthropic: vi.fn<(options: Record<string, unknown>) => typeof model>(function () { return model; }),
    xai: vi.fn<(options: Record<string, unknown>) => typeof model>(function () { return model; }),
  };
});
vi.mock("@langchain/aws", () => ({ ChatBedrockConverse: mocks.bedrock }));
vi.mock("@langchain/anthropic", () => ({ ChatAnthropic: mocks.anthropic }));
vi.mock("@langchain/xai", () => ({ ChatXAI: mocks.xai }));

let llm: typeof import("../../src/lib/llm");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of ["LLM_PROVIDER", "AGENT_PROVIDER", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "ANTHROPIC_API_KEY", "XAI_API_KEY", "HINT_TIMEOUT_MS", "MOCK_LLM"]) {
    vi.stubEnv(key, "");
  }
  vi.stubEnv("HINT_MODEL_ID", "test-hint");
  vi.stubEnv("AGENT_MODEL_ID", "test-agent");
  vi.stubEnv("READER_MODEL_ID", "test-reader");
  mocks.invoke.mockResolvedValue(new AIMessage("OK"));
  llm = await import("../../src/lib/llm");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("provider selection and constructors", () => {
  it("defaults to Bedrock", () => {
    expect(llm.providerFor("hint")).toBe("bedrock");
    expect(llm.getChatModel("hint")).toBe(mocks.model);
    expect(mocks.bedrock).toHaveBeenCalledWith({ model: "test-hint", region: "us-east-1" });
  });

  it.each(["bedrock", "anthropic", "xai"] as const)("constructs the %s class (AC3)", (provider) => {
    vi.stubEnv("LLM_PROVIDER", provider);
    llm.getChatModel(provider === "xai" ? "agent" : "hint");
    expect(mocks[provider]).toHaveBeenCalledOnce();
    for (const other of ["bedrock", "anthropic", "xai"] as const) {
      if (other !== provider) expect(mocks[other]).not.toHaveBeenCalled();
    }
    const options = mocks[provider].mock.calls[0]?.[0];
    expect(options).not.toHaveProperty("temperature");
    for (const key of ["top_p", "top_k", "topP", "topK"]) expect(options).not.toHaveProperty(key);
  });

  it("overrides only the agent provider (AC4)", () => {
    vi.stubEnv("LLM_PROVIDER", "bedrock");
    vi.stubEnv("AGENT_PROVIDER", "xai");
    expect(llm.providerFor("agent")).toBe("xai");
    expect(llm.providerFor("hint")).toBe("bedrock");
    expect(llm.providerFor("reader")).toBe("bedrock");
    llm.getChatModel("agent");
    expect(mocks.xai).toHaveBeenCalledWith({ model: "test-agent", apiKey: undefined });
  });

  it.each(["hint", "reader"] as const)("rejects xai for the %s role", (role) => {
    vi.stubEnv("LLM_PROVIDER", "xai");
    expect(() => llm.getChatModel(role)).toThrow(/only.*agent/i);
    expect(mocks.xai).not.toHaveBeenCalled();
  });

  it("ignores an invalid agent override on hint and reader", () => {
    vi.stubEnv("AGENT_PROVIDER", "invalid");
    expect(llm.providerFor("hint")).toBe("bedrock");
    expect(llm.providerFor("reader")).toBe("bedrock");
    expect(() => llm.providerFor("agent")).toThrow(/Unsupported model provider/);
  });

  it("rejects an unknown base provider", () => {
    vi.stubEnv("LLM_PROVIDER", "invalid");
    expect(() => llm.providerFor("hint")).toThrow(/Unsupported model provider/);
  });

  it.each(["hint", "agent", "reader"] as const)("uses the env model id for %s", (role) => {
    llm.getChatModel(role);
    expect(mocks.bedrock).toHaveBeenCalledWith(expect.objectContaining({ model: `test-${role}` }));
    vi.stubEnv(`${role.toUpperCase()}_MODEL_ID`, "  ");
    expect(() => llm.getChatModel(role)).toThrow(`${role.toUpperCase()}_MODEL_ID`);
  });

  it("passes the configured AWS region and temporary credentials", () => {
    vi.stubEnv("AWS_REGION", "us-west-2");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "test-session");
    llm.getChatModel("reader");
    expect(mocks.bedrock).toHaveBeenCalledWith({
      model: "test-reader", region: "us-west-2",
      credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret", sessionToken: "test-session" },
    });
  });

  it.each(["anthropic", "xai"] as const)("passes the %s API key", (provider) => {
    vi.stubEnv("LLM_PROVIDER", provider);
    vi.stubEnv(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "XAI_API_KEY", "test-key");
    llm.getChatModel("agent");
    expect(mocks[provider]).toHaveBeenCalledWith({ model: "test-agent", apiKey: "test-key" });
  });
});

describe("live probe behavior with mocked replies", () => {
  it("pings the hint model with a bounded request", async () => {
    const result = await llm.pingModel();
    expect(result).toMatchObject({ ok: true, modelId: "test-hint" });
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(mocks.invoke).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it.each(["", "   "])("rejects an empty model reply (%j)", async (text) => {
    mocks.invoke.mockResolvedValue(new AIMessage(text));
    expect((await llm.pingModel()).ok).toBe(false);
  });

  it("fails without a model id and makes no model call", async () => {
    vi.stubEnv("HINT_MODEL_ID", "");
    expect(await llm.pingModel()).toMatchObject({ ok: false, modelId: "" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("returns failure when a provider rejects the request", async () => {
    mocks.invoke.mockRejectedValue(new Error("provider failure"));
    expect((await llm.pingModel()).ok).toBe(false);
    expect(await llm.pingVision()).toMatchObject({ ok: false, answer: "" });
  });

  it("sends the checked-in PNG to the reader without correcting the equation", async () => {
    mocks.invoke.mockResolvedValue(new AIMessage([{ type: "text", text: "2 + 2 = 5" }]));
    const result = await llm.pingVision();
    expect(result).toMatchObject({ ok: true, answer: "2 + 2 = 5" });
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(mocks.bedrock).toHaveBeenCalledWith(expect.objectContaining({ model: "test-reader" }));
    const message = mocks.invoke.mock.calls[0]?.[0]?.[0];
    expect(message).toBeInstanceOf(HumanMessage);
    expect(message.content).toEqual([
      { type: "text", text: "What equation is written? Reply with the equation only." },
      { type: "image_url", image_url: { url: `data:image/png;base64,${readFileSync("fixtures/eval/ping.png").toString("base64")}` } },
    ]);
  });

  it("asks a given question about a given image (P2.7 snapshot probe)", async () => {
    mocks.invoke.mockResolvedValue(new AIMessage("7"));
    const accept = vi.fn((answer: string) => answer === "7");
    const result = await llm.pingVision({ imagePath: "fixtures/eval/ping.png", question: "Which number?", accept });
    expect(result).toMatchObject({ ok: true, answer: "7" });
    expect(accept).toHaveBeenCalledWith("7");
    expect(mocks.invoke.mock.calls[0]?.[0]?.[0].content[0]).toEqual({ type: "text", text: "Which number?" });
    mocks.invoke.mockResolvedValue(new AIMessage("8"));
    expect((await llm.pingVision({ imagePath: "fixtures/eval/ping.png", question: "Which number?", accept })).ok).toBe(false);
    expect((await llm.pingVision({ imagePath: "fixtures/eval/missing.png", question: "Which number?", accept: () => true })).ok).toBe(false);
  });

  it.each(["2 + 2 = 4", "2 = 5", "unreadable"])("fails the vision check for %s", async (text) => {
    mocks.invoke.mockResolvedValue(new AIMessage(text));
    expect((await llm.pingVision()).ok).toBe(false);
  });
});

describe("health cache", () => {
  it("shares concurrent pings and refreshes after 60 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = llm.modelHealth();
    expect(llm.modelHealth()).toBe(first);
    expect(await first).toBe(true);
    vi.setSystemTime(60999);
    expect(await llm.modelHealth()).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    vi.setSystemTime(61000);
    expect(await llm.modelHealth()).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("caches failures too", async () => {
    mocks.invoke.mockRejectedValue(new Error("unavailable"));
    expect(await llm.modelHealth()).toBe(false);
    expect(await llm.modelHealth()).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("refreshes when the configured hint model changes", async () => {
    await llm.modelHealth();
    vi.stubEnv("HINT_MODEL_ID", "changed-hint");
    await llm.modelHealth();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps offline mock mode free of live calls", async () => {
    vi.stubEnv("MOCK_LLM", "1");
    expect(await llm.modelHealth()).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
