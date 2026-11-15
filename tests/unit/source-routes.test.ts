import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRepo } from "../../src/lib/db/memory";
import type { Repo } from "../../src/lib/contracts";
import { HintRequestSchema } from "../../src/lib/contracts";
import { config, recordedTransport, SHA } from "./github-fixtures";
import { importGitHubCourse, sourceFileId } from "../../src/lib/lms/github";
import { fixtureManifest } from "./github-fixtures";

const state = vi.hoisted(() => ({ repo: null as Repo | null }));
vi.mock("../../src/lib/db", () => ({ getRepo: () => state.repo }));
// Route handlers call connection(), which needs a Next request scope; tests call them directly.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
import { POST as connect } from "../../src/app/api/source/connect/route";
import { GET as courses } from "../../src/app/api/source/courses/route";
import { GET as original } from "../../src/app/api/files/[fileId]/route";
import { POST as hint } from "../../src/app/api/hint/route";
import * as mock from "../../src/lib/tutor/mock";

beforeEach(() => {
  state.repo = new MemoryRepo();
  vi.stubEnv("COURSE_GITHUB_REPO", config.repository);
  vi.stubEnv("COURSE_GITHUB_REF", config.ref);
  vi.stubEnv("COURSE_MANIFEST_PATH", config.manifestPath);
  vi.stubEnv("COURSE_DEMO_DAY", config.demoDay);
  vi.stubEnv("COURSE_GITHUB_TOKEN", "server-only-token");
  vi.stubEnv("DEMO_STUDENT_ID", "demo");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("connect imports configured source, returns only public metadata, and sends token only in headers", async () => {
  const transport = recordedTransport();
  vi.stubGlobal("fetch", transport);
  const response = await connect();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ courseId: expect.any(String), title: fixtureManifest().course.title, commitSha: SHA });
  expect(JSON.stringify(body)).not.toContain("server-only-token");
  expect(JSON.stringify(await state.repo!.getConnection("demo"))).not.toContain("server-only-token");
  for (const [url, init] of transport.mock.calls) {
    expect(String(url)).not.toContain("server-only-token");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-only-token");
    expect(init?.redirect).toBe("error");
  }
  expect((await (await courses()).json())[0].ingested).toBe(false);
  const course = (await state.repo!.getCourse(body.courseId))!;
  await state.repo!.upsertCourse({ ...course, ingestedAt: "2026-11-14T12:00:00Z" });
  expect((await (await courses()).json())[0].ingested).toBe(true);
});

it("cached course list, original file and mocked hint work with GitHub transport disabled", async () => {
  const course = await importGitHubCourse(state.repo!, config, { transport: recordedTransport() });
  const disabled = vi.fn<typeof fetch>().mockRejectedValue(new Error("GitHub disabled"));
  vi.stubGlobal("fetch", disabled);
  expect(await (await courses()).json()).toEqual([{ id: course.id, title: course.title, shortName: "CALC2", ingested: false }]);
  const file = fixtureManifest().files[0]!;
  const response = await original(new Request("http://localhost/api/files/x"), { params: Promise.resolve({ fileId: sourceFileId(course.id, file.path) }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(readFileSync(`fixtures/github/files/synthetic/${file.path}`)));
  vi.stubEnv("MOCK_LLM", "1");
  const stream = mock.streamMockHint;
  vi.spyOn(mock, "streamMockHint").mockImplementation(fixture => stream(fixture, async () => {}));
  const input = HintRequestSchema.parse(JSON.parse(readFileSync("fixtures/eval/requests/missing-dx-r1.json", "utf8")));
  const reply = await hint(new Request("http://localhost/api/hint", { method: "POST", body: JSON.stringify(input) }));
  expect(await reply.text()).toContain('"type":"done"');
  expect(disabled).not.toHaveBeenCalled();
});

it("missing files return safe 404 without a network fallback; no connection lists no courses", async () => {
  const disabled = vi.fn<typeof fetch>().mockRejectedValue(new Error("GitHub disabled"));
  vi.stubGlobal("fetch", disabled);
  expect(await (await courses()).json()).toEqual([]);
  const response = await original(new Request("http://localhost/api/files/x"), { params: Promise.resolve({ fileId: "missing" }) });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "not_found", message: "The course source or cached file was not found." });
  expect(disabled).not.toHaveBeenCalled();
});

it.each([[404, "not_found"], [403, "forbidden"], [429, "rate_limited"], [502, "unavailable"]])("connect maps upstream %i without leaking bodies or tokens", async (status, code) => {
  const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("server-only-token", { status: Number(status) })));
  const response = await connect();
  const body = await response.json();
  expect(body.code).toBe(code);
  expect(JSON.stringify(body)).not.toContain("server-only-token");
  expect(JSON.stringify(log.mock.calls)).not.toContain("server-only-token");
  expect(JSON.stringify(error.mock.calls)).not.toContain("server-only-token");
  expect(await state.repo!.getConnection("demo")).toBeNull();
});
