import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintEventSchema, HintRequestSchema, type HintEvent } from "../../src/lib/contracts";
import { POST } from "../../src/app/api/hint/route";
import * as mock from "../../src/lib/tutor/mock";
import * as live from "../../src/lib/tutor/hint";

const input = HintRequestSchema.parse(JSON.parse(await readFile("fixtures/eval/requests/missing-dx-r1.json", "utf8")));
const request = (body?: string) => new Request("http://localhost/api/hint", { method: "POST", body });
const lines = async (response: Response) => (await response.text()).trimEnd().split("\n").map((line) => HintEventSchema.parse(JSON.parse(line)));
beforeEach(() => { vi.stubEnv("MOCK_LLM", "1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("P3.1-AC3 bad requests", () => {
  it.each([undefined, "", "{", "null", "{}", JSON.stringify({ ...input, rung: 4 })])("rejects empty, invalid JSON or schema-invalid body %j with exactly one NDJSON line", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const text = await response.text();
    expect(text.split("\n")).toHaveLength(2);
    expect(text.endsWith("\n")).toBe(true);
    expect(HintEventSchema.parse(JSON.parse(text))).toMatchObject({ type: "error", code: "bad_request" });
  });
});

it("P3.1-AC1 route streams every validated mock event in order and ends in done", async () => {
  const stream = mock.streamMockHint;
  vi.spyOn(mock, "streamMockHint").mockImplementation((fixture) => stream(fixture, async () => {}));
  const response = await POST(request(JSON.stringify(input)));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  const output = lines(response);
  const events = await output;
  expect(events).toEqual((await mock.loadMockHint(input)).events);
  expect(events.at(-1)?.type).toBe("done");
});

it("delegates to runHint when MOCK_LLM is off, without reconstructing live storage", async () => {
  vi.stubEnv("MOCK_LLM", "0");
  vi.stubEnv("STORE", "not-used-by-the-route");
  const expected: HintEvent[] = [
    { type: "started", hintId: "live", at: 0 },
    { type: "done", hintId: "live", ms: { firstEvent: 10, total: 20 } },
  ];
  const run = vi.spyOn(live, "runHint").mockImplementation(async function* () { yield* expected; });
  expect(await lines(await POST(request(JSON.stringify(input))))).toEqual(expected);
  expect(run).toHaveBeenCalledExactlyOnceWith(input);
});

it("reports fixture loading failure as an error event", async () => {
  const response = await POST(request(JSON.stringify({ ...input, fixtureId: "../x" })));
  expect(await lines(response)).toMatchObject([{ type: "error", code: "model_unavailable" }]);
});

it("emits an error with the hint id when the producer throws partway through", async () => {
  vi.spyOn(mock, "streamMockHint").mockImplementation(async function* (): AsyncGenerator<HintEvent> {
    yield { type: "started", hintId: "partial", at: 0 };
    throw new Error("fixture stream failed");
  });
  expect(await lines(await POST(request(JSON.stringify(input))))).toMatchObject([
    { type: "started", hintId: "partial" }, { type: "error", hintId: "partial", code: "model_unavailable" },
  ]);
});

it("produces the first line before awaiting the rest of the stream", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(mock, "streamMockHint").mockImplementation(async function* (): AsyncGenerator<HintEvent> {
    yield { type: "started", hintId: "live", at: 0 };
    await gate;
    yield { type: "done", hintId: "live", ms: { firstEvent: 1, total: 2 } };
  });
  const reader = (await POST(request(JSON.stringify(input)))).body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"started"');
  release();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"done"');
  expect((await reader.read()).done).toBe(true);
});

it("closes cleanly when a client cancels a sleeping mock stream", async () => {
  const reader = (await POST(request(JSON.stringify(input)))).body!.getReader();
  await reader.cancel();
  expect((await reader.read()).done).toBe(true);
});

it("closes a pending read when the request is aborted between events", async () => {
  const controller = new AbortController();
  const response = await POST(new Request("http://localhost/api/hint", {
    method: "POST", body: JSON.stringify(input), signal: controller.signal,
  }));
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  const next = reader.read();
  controller.abort();
  expect((await next).done).toBe(true);
});

it("preserves repeated mock hint timestamps while deduplicating evidence and recomputing levels", async () => {
  vi.stubEnv("STORE", "memory");
  const { getRepo } = await import("../../src/lib/db");
  const { TeachingCardSchema, SessionSchema, WorksheetSchema } = await import("../../src/lib/contracts");
  const { examples } = await import("./contracts.examples");
  const repo = getRepo();
  const card = TeachingCardSchema.parse(examples.TeachingCard.valid);
  card.subskills[0]!.id = "u3.find_dx";
  const session = { ...SessionSchema.parse(examples.Session.valid), id: "persisted-hint-test", worksheetId: input.worksheetId };
  const worksheet = { ...WorksheetSchema.parse(examples.Worksheet.valid), id: input.worksheetId, problems: [{ ...WorksheetSchema.parse(examples.Worksheet.valid).problems[0]!, id: input.problemId, subskillIds: [card.subskills[0]!.id] }] };
  await repo.upsertCard(card);
  await repo.upsertWorksheet(worksheet);
  await repo.createSession(session);
  const stream = mock.streamMockHint;
  vi.spyOn(mock, "streamMockHint").mockImplementation(fixture => stream(fixture, async () => {}));
  for (let n = 0; n < 2; n++) {
    const events = await lines(await POST(request(JSON.stringify({ ...input, sessionId: session.id }))));
    expect(events.at(-1)?.type).toBe("done");
  }
  const hints = await repo.listHints({ sessionId: session.id });
  expect(hints).toHaveLength(2);
  expect(hints[0]!.id).not.toBe(hints[1]!.id);
  expect(await repo.listEvidence(session.studentId, session.courseId)).toHaveLength(1);
  expect((await repo.listSkills(session.studentId, session.courseId)).find(s => s.subskillId === card.subskills[0]!.id)).toMatchObject({ level: 1, recentErrorTypes: ["missing_dx"] });
});
