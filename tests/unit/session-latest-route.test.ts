import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionEvent } from "../../src/lib/contracts";
import { getRepo } from "../../src/lib/db";
import { POST as startSession } from "../../src/app/api/session/route";
import { POST as postEvents } from "../../src/app/api/session/[id]/events/route";
import { POST as endSession } from "../../src/app/api/session/[id]/end/route";
import { GET as latest } from "../../src/app/api/session/latest/route";

beforeEach(() => { vi.stubEnv("STORE", "memory"); });
afterEach(() => { vi.unstubAllEnvs(); });

const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ev = (at: number, problemId: string): SessionEvent => ({ type: "problem_opened", at, problemId });
const get = (query: string) => latest(new Request(`http://localhost/api/session/latest${query}`));
let counter = 0;
const fresh = () => `sheet-${Date.now()}-${counter++}`;

async function open(worksheetId: string) {
  const sessionId = ((await (await startSession(json({ worksheetId }))).json()) as { sessionId: string }).sessionId;
  await new Promise((resolve) => setTimeout(resolve, 5)); // distinct startedAt
  return sessionId;
}

describe("R2.3 GET /api/session/latest", () => {
  it("returns the latest open session with its events in order", async () => {
    const worksheetId = fresh();
    const older = await open(worksheetId);
    const newer = await open(worksheetId);
    await postEvents(json({ events: [ev(5, "a"), ev(2, "b")] }), ctx(newer));
    await postEvents(json({ events: [ev(5, "c")] }), ctx(newer));
    await postEvents(json({ events: [ev(1, "old")] }), ctx(older));
    const response = await get(`?worksheetId=${worksheetId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: Session; events: SessionEvent[] };
    expect(body.session.id).toBe(newer);
    expect(body.session.worksheetId).toBe(worksheetId);
    expect(body.events.map((e) => e.type === "problem_opened" && e.problemId)).toEqual(["b", "a", "c"]);
  });

  it("skips a closed session", async () => {
    const worksheetId = fresh();
    const older = await open(worksheetId);
    const newer = await open(worksheetId);
    await postEvents(json({ events: [ev(1, "keep")] }), ctx(older));
    expect((await endSession(json(null), ctx(newer))).status).toBe(200);
    const body = (await (await get(`?worksheetId=${worksheetId}`)).json()) as { session: Session; events: SessionEvent[] };
    expect(body.session.id).toBe(older);
    expect(body.events).toHaveLength(1);
    await endSession(json(null), ctx(older));
    expect((await get(`?worksheetId=${worksheetId}`)).status).toBe(404);
  });

  it("returns an open session with no events as an empty list", async () => {
    const worksheetId = fresh();
    await open(worksheetId);
    const body = (await (await get(`?worksheetId=${worksheetId}`)).json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });

  it("404s for an unknown worksheet", async () => {
    expect((await get(`?worksheetId=${fresh()}`)).status).toBe(404);
    expect(await getRepo().latestOpenSession("never-used")).toBeNull();
  });

  it("400s for a bad query", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?worksheetId=")).status).toBe(400);
    expect((await get("?other=x")).status).toBe(400);
  });
});
