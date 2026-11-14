import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../../src/lib/contracts";
import { POST as startSession } from "../../src/app/api/session/route";
import { POST as postEvents } from "../../src/app/api/session/[id]/events/route";
import { POST as endSession } from "../../src/app/api/session/[id]/end/route";
import { GET as readEvents } from "../../src/app/api/dev/session-events/route";

beforeEach(() => { vi.stubEnv("STORE", "memory"); });
afterEach(() => { vi.unstubAllEnvs(); });

const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ev = (n: number): SessionEvent => ({ type: "problem_opened", at: n, problemId: `p${n}` });
async function open() {
  const response = await startSession(json({ worksheetId: "demo" }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { sessionId: string }).sessionId;
}

describe("P2.8 session routes", () => {
  it("creates a session, stores event batches in order and marks it ended", async () => {
    const id = await open();
    expect((await postEvents(json({ events: [ev(1), ev(2)] }), ctx(id))).status).toBe(200);
    expect((await postEvents(json({ events: [ev(3)] }), ctx(id))).status).toBe(200);
    const read = await readEvents(new Request(`http://localhost/api/dev/session-events?id=${id}`));
    expect(((await read.json()) as { events: SessionEvent[] }).events.map((e) => e.at)).toEqual([1, 2, 3]);

    const end = await endSession(json(null), ctx(id));
    expect(end.status).toBe(200);
    expect(await end.json()).toEqual({ evidenceAdded: 0 });
  });

  it("rejects a bad start body, bad events, and unknown sessions", async () => {
    expect((await startSession(json({}))).status).toBe(400);
    expect((await startSession(new Request("http://localhost/x", { method: "POST", body: "{" }))).status).toBe(400);
    const id = await open();
    expect((await postEvents(json({ events: [{ type: "nope", at: 1 }] }), ctx(id))).status).toBe(400);
    expect((await postEvents(json({}), ctx(id))).status).toBe(400);
    expect((await postEvents(json({ events: [ev(1)] }), ctx("missing"))).status).toBe(404);
    expect((await endSession(json(null), ctx("missing"))).status).toBe(404);
    const read = await readEvents(new Request(`http://localhost/api/dev/session-events?id=${id}`));
    expect(((await read.json()) as { events: unknown[] }).events).toEqual([]);
  });

  it("the dev read-back route is 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await readEvents(new Request("http://localhost/api/dev/session-events?id=x"))).status).toBe(404);
  });
});
