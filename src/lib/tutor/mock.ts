import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MockHintSchema, type HintRequest, type MockHint } from "../contracts";

const safeStem = /^[A-Za-z0-9_-]+$/;

/** Implicit worksheet fixtures may describe different work on the same problem. */
function matchesRequest(mock: MockHint, req: HintRequest): boolean {
  const rows = new Map(req.rows.map((row) => [row.rowId, row]));
  const targetExists = (rowId: string, ids: string[]) => {
    const row = rows.get(rowId);
    return row !== undefined && row.clusterLabels.length > 0
      && ids.every((id) => row.clusterLabels.some((label) => id === `${rowId}/c${label}`));
  };
  return mock.events.every((event) => {
    if (event.type === "reading") return event.rows.every((row) => targetExists(row.rowId, []));
    if (event.type === "diagnosis" && event.rowId !== undefined) return targetExists(event.rowId, event.clusterIds ?? []);
    if (event.type === "mark") {
      const mark = event.mark;
      return mark.type === "arrow" ? targetExists(mark.toRowId, mark.toClusterIds) : targetExists(mark.rowId, mark.clusterIds);
    }
    return true;
  });
}

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
  try {
    const mock = await read(derived);
    return matchesRequest(mock, req) ? mock : read(`default-r${req.rung}`);
  } catch (error) {
    // A malformed fixture must fail visibly, rather than silently use a fallback.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return read(`default-r${req.rung}`);
  }
}

export async function* streamMockHint(mock: MockHint, sleep: (ms: number) => Promise<void>) {
  for (const [index, event] of mock.events.entries()) {
    await sleep(mock.delaysMs[index]!);
    yield event;
  }
}
