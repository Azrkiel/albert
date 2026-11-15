import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { z } from "zod";
import { HintRequestSchema, type HintEvent } from "../src/lib/contracts";
import { MemoryRepo, seedDemo } from "../src/lib/db";
import { runHint } from "../src/lib/tutor/hint";
import { getHintModel } from "../src/lib/tutor/tools";
import { hintText } from "../src/lib/tutor/ladder";

// Whitelist diagnostic fields. Never print provider messages, request bodies,
// credentials, or an arbitrary exception name supplied by a remote service.
const providerFailureSchema = z.object({
  name: z.enum([
    "AbortError", "TimeoutError", "CredentialsProviderError", "AccessDeniedException", "UnrecognizedClientException",
    "InvalidSignatureException", "ExpiredTokenException", "ValidationException", "ThrottlingException",
    "ServiceUnavailableException", "InternalServerException", "ModelTimeoutException", "ModelNotReadyException",
    "ModelErrorException", "ResourceNotFoundException", "Error", "TypeError",
  ]).catch("Error"),
  code: z.enum(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ERR_HTTP2_ERROR", "ERR_HTTP2_STREAM_CANCEL",
    "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED"])
    .optional().catch(undefined),
  $metadata: z.object({ httpStatusCode: z.number().int().min(100).max(599).optional() }).optional().catch(undefined),
});

async function checkConnection(timeoutMs: number) {
  const region = z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/).parse(process.env.AWS_REGION || "us-east-1");
  const suffix = region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com";
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_BEDROCK_RUNTIME || process.env.AWS_ENDPOINT_URL
    || `https://bedrock-runtime.${region}.${suffix}`);
  if (endpoint.protocol !== "https:") throw new Error("The connection check requires a TLS endpoint.");
  const host = endpoint.hostname;
  const port = Number(endpoint.port || 443);
  const start = performance.now();
  const result = await new Promise<{ ok: boolean; alpn?: string; error?: string }>((resolve) => {
    // TLS + ALPN only: no HTTP request, credentials, or model invocation.
    const socket = connectTls({ host, port, servername: isIP(host) ? undefined : host, ALPNProtocols: ["h2"] });
    let finished = false;
    const finish = (value: { ok: boolean; alpn?: string; error?: string }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), timeoutMs);
    socket.once("secureConnect", () => {
      const alpn = socket.alpnProtocol || "none";
      finish({ ok: alpn === "h2", alpn, ...(alpn === "h2" ? {} : { error: "http2_not_negotiated" }) });
    });
    socket.once("error", (error) => {
      const parsed = providerFailureSchema.safeParse(error);
      finish({ ok: false, error: parsed.success ? parsed.data.code ?? "connection_failed" : "connection_failed" });
    });
  });
  return { check: "tls_h2", host, port, ...result, elapsedMs: Math.round(performance.now() - start), timeoutMs, liveCalls: 0 };
}

async function main() {
  const [file, ...options] = process.argv.slice(2);
  if (!file) throw new Error("Expected a request path.");
  if (options.length !== 0 && (options.length !== 2 || options[0] !== "--timeout-ms")) {
    throw new Error("Expected an optional --timeout-ms <milliseconds>.");
  }
  const timeoutMs = z.coerce.number().int().positive().max(2_147_483_647)
    .parse(options[1] ?? (process.env.HINT_TIMEOUT_MS || 12_000));
  // A diagnostic override is local to this CLI process; the app keeps its default.
  if (options.length) process.env.HINT_TIMEOUT_MS = String(timeoutMs);
  if (file === "--check-connection") {
    const result = await checkConnection(timeoutMs);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const request = HintRequestSchema.parse(JSON.parse(await readFile(file, "utf8")));
  if (request.image.width <= 1 || request.image.height <= 1) throw new Error("Use a real snapshot, not the placeholder mock image.");
  if (process.env.MOCK_LLM === "1") throw new Error("hint-once requires live mode.");
  if (process.env.LLM_PROVIDER !== "bedrock" || !["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "HINT_MODEL_ID"].every((key) => process.env[key])) {
    throw new Error("Live Bedrock configuration is missing.");
  }
  // This one-off fixture check spends tokens only on the model. Keep its hint
  // and the demo course in memory even when .env.local points at a real DB.
  const repo = new MemoryRepo();
  await seedDemo(repo);
  const bound = getHintModel();
  let calls = 0;
  let providerFailure: { name: string; code?: string; httpStatus?: number } | undefined;
  const events: HintEvent[] = [];
  const startedAt = performance.now();
  for await (const event of runHint(request, { repo, model: {
    invoke: async (messages, options) => {
      calls++;
      try { return await bound.invoke(messages, options); }
      catch (error) {
        const parsed = providerFailureSchema.safeParse(error);
        if (parsed.success) providerFailure = { name: parsed.data.name, code: parsed.data.code, httpStatus: parsed.data.$metadata?.httpStatusCode };
        throw error;
      }
    },
    dispose: bound.dispose,
  } })) events.push(event);
  const elapsedMs = Math.round(performance.now() - startedAt);
  const diagnosis = events.find((event) => event.type === "diagnosis");
  const hint = events.find((event) => event.type === "hint");
  const done = events.find((event) => event.type === "done");
  const error = events.find((event) => event.type === "error");
  console.log(JSON.stringify({
    status: diagnosis?.status, row: request.rows.find((row) => row.rowId === diagnosis?.rowId)?.index,
    clusters: diagnosis?.clusterIds?.map((id) => Number(id.slice(id.lastIndexOf("/c") + 2))),
    kind: hint?.kind, text: hint ? hintText(hint) : undefined, ms: done?.ms,
    elapsedMs, timeoutMs, retries: Math.max(0, calls - 1), liveCalls: calls, transportRetries: 0, error: error?.code, providerFailure,
  }, null, 2));
  if (error || !done) process.exitCode = 1;
}

main().catch(() => {
  console.error("Hint tooling failed. Check the request/options and Bedrock configuration; raw errors are withheld to protect secrets.");
  process.exitCode = 1;
});
