import { readFile } from "node:fs/promises";
import { HintRequestSchema, type HintEvent } from "../src/lib/contracts";
import { MemoryRepo, seedDemo } from "../src/lib/db";
import { runHint } from "../src/lib/tutor/hint";
import { getHintModel } from "../src/lib/tutor/tools";
import { hintText } from "../src/lib/tutor/ladder";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Expected a request path.");
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
  const events: HintEvent[] = [];
  for await (const event of runHint(request, { repo, model: {
    invoke: (messages, options) => { calls++; return bound.invoke(messages, options); },
  } })) events.push(event);
  const diagnosis = events.find((event) => event.type === "diagnosis");
  const hint = events.find((event) => event.type === "hint");
  const done = events.find((event) => event.type === "done");
  const error = events.find((event) => event.type === "error");
  console.log(JSON.stringify({
    status: diagnosis?.status, row: request.rows.find((row) => row.rowId === diagnosis?.rowId)?.index,
    clusters: diagnosis?.clusterIds?.map((id) => Number(id.slice(id.lastIndexOf("/c") + 2))),
    kind: hint?.kind, text: hint ? hintText(hint) : undefined, ms: done?.ms,
    retries: Math.max(0, calls - 1), liveCalls: calls, error: error?.code,
  }, null, 2));
  if (error || !done) process.exitCode = 1;
}

main().catch(() => {
  console.error("Hint check failed. Supply a real snapshot and live Bedrock configuration; provider errors are withheld to protect secrets.");
  process.exitCode = 1;
});
