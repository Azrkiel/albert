import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MockHintSchema, type HintRequest, type MockHint } from "../contracts";

const safeStem = /^[A-Za-z0-9_-]+$/;

export async function loadMockHint(req: HintRequest): Promise<MockHint> {
  const read = async (stem: string) => MockHintSchema.parse(JSON.parse(
    await readFile(join(process.cwd(), "fixtures", "llm", `${stem}.json`), "utf8"),
  ));
  if (req.fixtureId !== undefined) {
    if (!safeStem.test(req.fixtureId)) throw new Error("Invalid hint fixtureId");
    return read(req.fixtureId);
  }
  if (req.problemSource === "handwriting") return read(`handwriting-r${req.rung}`);
  const derived = `${req.problemId.replaceAll("/", "_")}-r${req.rung}`;
  if (!safeStem.test(derived)) throw new Error("Invalid hint problemId for mock lookup");
  // R3.1: a request with a question prefers the "-question" fixtures, then the plain ones.
  const suffix = req.question === undefined ? "" : "-question";
  try {
    return await read(derived + suffix);
  } catch (error) {
    // A malformed fixture must fail visibly, rather than silently use a fallback.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return read(`default-r${req.rung}${suffix}`);
  }
}

export async function* streamMockHint(mock: MockHint, sleep: (ms: number) => Promise<void>) {
  for (const [index, event] of mock.events.entries()) {
    await sleep(mock.delaysMs[index]!);
    yield event;
  }
}
