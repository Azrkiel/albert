import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ChatBedrockConverse } from "@langchain/aws";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatXAI } from "@langchain/xai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

export type ModelRole = "hint" | "agent" | "reader";
type Provider = "bedrock" | "anthropic" | "xai";

const MODEL_ENV = {
  hint: "HINT_MODEL_ID",
  agent: "AGENT_MODEL_ID",
  reader: "READER_MODEL_ID",
} as const;

export function providerFor(role: ModelRole): Provider {
  const base = process.env.LLM_PROVIDER?.trim() || "bedrock";
  const provider = role === "agent" ? process.env.AGENT_PROVIDER?.trim() || base : base;
  if (provider !== "bedrock" && provider !== "anthropic" && provider !== "xai") {
    throw new Error("Unsupported model provider; use bedrock, anthropic, or xai.");
  }
  if (provider === "xai" && role !== "agent") {
    throw new Error("xai is supported only for the agent role; use AGENT_PROVIDER=xai.");
  }
  return provider;
}

export function getChatModel(role: ModelRole): BaseChatModel {
  const provider = providerFor(role);
  const model = process.env[MODEL_ENV[role]]?.trim();
  if (!model) throw new Error(`Missing ${MODEL_ENV[role]}`);

  switch (provider) {
    case "bedrock": {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const sessionToken = process.env.AWS_SESSION_TOKEN;
      return new ChatBedrockConverse({
        model,
        region: process.env.AWS_REGION?.trim() || "us-east-1",
        ...(accessKeyId && secretAccessKey ? {
          credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
        } : {}),
      });
    }
    case "anthropic":
      return new ChatAnthropic({ model, apiKey: process.env.ANTHROPIC_API_KEY || undefined });
    case "xai":
      return new ChatXAI({ model, apiKey: process.env.XAI_API_KEY || undefined });
  }
}

const ProbeText = z.string().trim().min(1);
const VisionText = ProbeText.refine((text) => ["2", "+", "5"].every((part) => text.includes(part)));
const ProbeTimeout = z.coerce.number().int().positive().max(2_147_483_647);

function probeOptions() {
  const timeout = ProbeTimeout.parse(process.env.HINT_TIMEOUT_MS || 12_000);
  return { signal: AbortSignal.timeout(timeout) };
}

export async function pingModel(): Promise<{ ok: boolean; ms: number; modelId: string }> {
  const start = performance.now();
  const modelId = process.env.HINT_MODEL_ID?.trim() || "";
  let ok = false;
  try {
    const reply = await getChatModel("hint").invoke([new HumanMessage("Reply with OK only.")], probeOptions());
    ok = ProbeText.safeParse(reply.text).success;
  } catch {
    // Health and smoke expose a failed check, never provider errors containing credentials.
  }
  return { ok, ms: Math.round(performance.now() - start), modelId };
}

export type VisionProbe = {
  imagePath: string;                     // a PNG, relative to the repo root
  question: string;
  accept: (answer: string) => boolean;   // checks the model's trimmed reply
};

/** P1.4's check: the typed `2 + 2 = 5` image. */
export const PING_PROBE: VisionProbe = {
  imagePath: "fixtures/eval/ping.png",
  question: "What equation is written? Reply with the equation only.",
  accept: (answer) => VisionText.safeParse(answer).success,
};

/** Asks the reader model one question about one image. With no argument, it is P1.4's ping. */
export async function pingVision(probe: VisionProbe = PING_PROBE): Promise<{ ok: boolean; ms: number; answer: string }> {
  const start = performance.now();
  let answer = "";
  let ok = false;
  try {
    const model = getChatModel("reader");
    const image = await readFile(resolve(probe.imagePath));
    const reply = await model.invoke([new HumanMessage({ content: [
      { type: "text", text: probe.question },
      { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } },
    ] })], probeOptions());
    const text = ProbeText.safeParse(reply.text);
    if (text.success) answer = text.data;
    ok = text.success && probe.accept(answer);
  } catch {
    // A missing fixture, bad configuration, or provider failure is a failed vision check.
  }
  return { ok, ms: Math.round(performance.now() - start), answer };
}

let healthCache: { key: string; expiresAt: number; result: Promise<boolean> } | undefined;

export function modelHealth(): Promise<boolean> {
  // Offline browser tests must not spend tokens even when .env.local has live keys.
  if (process.env.MOCK_LLM === "1") return Promise.resolve(false);
  const key = JSON.stringify([process.env.LLM_PROVIDER, process.env.HINT_MODEL_ID, process.env.AWS_REGION]);
  const now = Date.now();
  if (!healthCache || healthCache.key !== key || now >= healthCache.expiresAt) {
    healthCache = {
      key,
      expiresAt: now + 60_000,
      result: pingModel().then((result) => result.ok).catch(() => false),
    };
  }
  return healthCache.result;
}
