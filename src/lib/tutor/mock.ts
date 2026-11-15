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
  // R3.1: a request with a question tries the problem's "-question" fixture, then the problem's plain one (its
  // recorded targets), then the default question fixture, then the default plain one.
  const stems = req.question === undefined
    ? [derived, `default-r${req.rung}`]
    : [`${derived}-question`, derived, `default-r${req.rung}-question`, `default-r${req.rung}`];
  for (const stem of stems.slice(0, -1)) {
    try {
      return await read(stem);
    } catch (error) {
      // A malformed fixture must fail visibly, rather than silently use a fallback.
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  return read(stems[stems.length - 1]!);
}

export async function* streamMockHint(mock: MockHint, sleep: (ms: number) => Promise<void>) {
  for (const [index, event] of mock.events.entries()) {
    await sleep(mock.delaysMs[index]!);
    yield event;
  }
}
