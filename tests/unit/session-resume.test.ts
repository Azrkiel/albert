import { afterEach, expect, it, vi } from "vitest";
import { createSessionConnection } from "../../src/components/work/useSessionSync";

const session = { id: "saved", studentId: "demo", courseId: "demo", worksheetId: "worksheet", startedAt: "2026-11-15T00:00:00Z", surface: "pdf" as const, fileId: "pdf" };
const events = [{ type: "problem_opened" as const, at: 123, problemId: "p1" }];
afterEach(() => vi.unstubAllGlobals());

it("restores once, adopts the saved id and posts only newly pushed events", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ session, events })).mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const restore = vi.fn();
  const connection = createSessionConnection("worksheet", { resume: true, fileId: "pdf", onRestore: restore });
  expect(await connection.ensure()).toBe("saved");
  expect(await connection.ensure()).toBe("saved");
  expect(connection.used).toBe(true); // Replacing restored history must start a new recording session.
  expect(restore).toHaveBeenCalledExactlyOnceWith(session, events);
  connection.sync.push(events[0]!);
  expect(await connection.sync.flush()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]![0]).toBe("/api/session/saved/events");
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ events });
});

it("creates only after a successful empty lookup and sends PDF metadata", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ session: null, events: [] })).mockResolvedValueOnce(Response.json({ sessionId: "new" }));
  vi.stubGlobal("fetch", fetch);
  expect(await createSessionConnection("worksheet", { resume: true, fileId: "pdf" }).ensure()).toBe("new");
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({ worksheetId: "worksheet", surface: "pdf", fileId: "pdf" });
});

it("retries lookup without creating on transport, validation or restoration failure", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(Response.json({ session: {}, events: [] })).mockResolvedValueOnce(Response.json({ session, events }));
  vi.stubGlobal("fetch", fetch);
  const connection = createSessionConnection("worksheet", { resume: true, fileId: "pdf", onRestore: () => { throw new Error("bad replay"); } });
  await expect(connection.ensure()).rejects.toThrow();
  await expect(connection.ensure()).rejects.toThrow();
  await expect(connection.ensure()).rejects.toThrow("bad replay");
  expect(fetch.mock.calls.every(call => call[1] === undefined)).toBe(true);
});

it("keeps the default connection's eager new-session behavior", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ sessionId: "legacy" }));
  vi.stubGlobal("fetch", fetch);
  expect(await createSessionConnection("worksheet").ensure()).toBe("legacy");
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/session", expect.objectContaining({ method: "POST" }));
});

it("starts a new PDF session without lookup when resume is disabled", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ sessionId: "fresh-pdf" }));
  vi.stubGlobal("fetch", fetch);
  expect(await createSessionConnection("worksheet", { resume: false, fileId: "pdf" }).ensure()).toBe("fresh-pdf");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ worksheetId: "worksheet", surface: "pdf", fileId: "pdf" });
});


it("superseded lookups neither restore stale ink nor create orphan sessions", async () => {
  for (const reply of [{ session, events }, { session: null, events: [] }]) {
    let current = true;
    const fetch = vi.fn(async () => { current = false; return Response.json(reply); });
    vi.stubGlobal("fetch", fetch);
    const restore = vi.fn();
    const connection = createSessionConnection("worksheet", { resume: true, fileId: "pdf", isCurrent: () => current, onRestore: restore });
    await expect(connection.ensure()).rejects.toThrow("Superseded");
    expect(restore).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});


it("flushes used legacy work on unmount after an initial session-create failure", async () => {
  let current = true;
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ sessionId: "saved-on-unmount" })).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  const connection = createSessionConnection("worksheet", { isCurrent: () => current });
  await expect(connection.ensure()).rejects.toThrow();
  connection.used = true; // The hook marks a connection used when it buffers student input.
  connection.sync.push(events[0]!);
  current = false;
  expect(await connection.sync.flush()).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[2]![0]).toBe("/api/session/saved-on-unmount/events");
});
