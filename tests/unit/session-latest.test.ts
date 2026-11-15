import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GET } from "../../src/app/api/session/latest/route";
import { POST } from "../../src/app/api/session/route";
import { getRepo } from "../../src/lib/db";

beforeEach(() => { vi.stubEnv("STORE", "memory"); vi.stubEnv("DEMO_STUDENT_ID", "resume-student"); });
afterEach(() => vi.unstubAllEnvs());
const lookup = (worksheetId: string, fileId = "pdf") => new Request(`http://localhost/api/session/latest?worksheetId=${worksheetId}&fileId=${fileId}`);

it("returns validated latest PDF session and its ordered events, excluding ended and legacy sessions", async () => {
  const worksheetId = randomUUID();
  expect(await (await GET(lookup(worksheetId))).json()).toEqual({ session: null, events: [] });
  const response = await POST(new Request("http://localhost/api/session", { method: "POST", body: JSON.stringify({ worksheetId, surface: "pdf", fileId: "pdf" }) }));
  const { sessionId } = await response.json();
  const events = [{ type: "problem_opened" as const, at: 12, problemId: "one" }, { type: "problem_opened" as const, at: 12, problemId: "two" }];
  await getRepo().appendEvents(sessionId, events);
  const latest = await GET(lookup(worksheetId));
  expect(latest.status).toBe(200);
  expect(latest.headers.get("Cache-Control")).toBe("no-store");
  expect(await latest.json()).toEqual({ session: await getRepo().getSession(sessionId), events });
  expect(await (await GET(lookup(worksheetId, "other"))).json()).toEqual({ session: null, events: [] });
  await getRepo().endSession(sessionId, new Date().toISOString());
  expect(await (await GET(lookup(worksheetId))).json()).toEqual({ session: null, events: [] });
});

it("rejects missing lookup identity and partial PDF metadata", async () => {
  expect((await GET(new Request("http://localhost/api/session/latest"))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/session/latest?worksheetId=x"))).status).toBe(400);
  for (const fields of [{ surface: "pdf" }, { fileId: "pdf" }, { surface: "free", fileId: "pdf" }]) {
    expect((await POST(new Request("http://localhost/api/session", { method: "POST", body: JSON.stringify({ worksheetId: "x", ...fields }) }))).status).toBe(400);
  }
});
