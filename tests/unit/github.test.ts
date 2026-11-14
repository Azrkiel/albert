import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRepo } from "../../src/lib/db/memory";
import { getAdapter } from "../../src/lib/lms";
import { CourseSourceError } from "../../src/lib/lms/adapter";
import { importGitHubCourse, manifestCacheId, normalizeManifest, parseManifest, sourceFileId } from "../../src/lib/lms/github";
import { guessKind } from "../../src/lib/lms/classify";
import { config, liveConfig, fixtureManifest, LIVE_SHA, recordedTransport, SHA } from "./github-fixtures";
import type { CourseManifest } from "../../src/lib/contracts";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([false, true])("maps recorded units, lecture labels, assignment links and dates (live=%s)", async live => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Networking disabled"); }));
  const repo = new MemoryRepo();
  const transport = recordedTransport(live);
  const selectedConfig = live ? liveConfig : config;
  const course = await importGitHubCourse(repo, selectedConfig, { transport });
  const manifest = fixtureManifest(live);
  expect(course.snapshot).toEqual({ owner: "Azrkiel", repo: live ? "albert-files" : "albert", commitSha: live ? LIVE_SHA : SHA, manifestPath: selectedConfig.manifestPath, demoDay: "2026-11-14" });
  expect(course.ingestedAt).toBeUndefined();
  const outline = await repo.getOutline(course.id);
  expect(outline?.units.map(u => [u.order, u.title, u.sectionId])).toEqual(manifest.units.map(u => [u.order, u.title, `${course.id}/u${u.order}`]));
  expect(outline?.units.flatMap(u => u.files).filter(f => f.kindGuess === "lecture_notes").map(f => f.lectureLabel)).toEqual(manifest.files.filter(f => f.kind === "lecture_notes").map(f => f.lectureLabel));
  expect(outline?.assignments.map(a => a.dueAt)).toEqual(live ? [undefined, undefined, undefined, undefined] : [undefined, undefined, "2026-11-18T23:59:59Z", "2026-11-25T23:59:59Z"]);
  expect(outline?.units.at(-1)?.files).toHaveLength(live ? 2 : 0);
  expect(outline?.files.map(f => f.kindGuess)).toEqual(live ? [] : ["syllabus"]);
  expect(outline?.assignments.map(a => a.fileRefs[0]?.url)).toEqual(manifest.assignments.map(a => `/api/files/${encodeURIComponent(sourceFileId(course.id, a.filePaths[0]!))}`));
  expect(JSON.parse(new TextDecoder().decode((await repo.getFile(manifestCacheId(course.id)))!.bytes))).toEqual(manifest);
  for (const file of manifest.files) {
    expect((await repo.getFile(sourceFileId(course.id, file.path)))?.bytes).toEqual(new Uint8Array(readFileSync(`fixtures/github/files/${live ? "live" : "synthetic"}/${file.path}`)));
  }
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("pins every request, encodes each path segment, and never mixes a moving branch's revisions", async () => {
  const repo = new MemoryRepo();
  const transport = recordedTransport();
  await importGitHubCourse(repo, { ...config, ref: "moving/branch" }, { transport });
  const urls = transport.mock.calls.map(([url]) => String(url));
  expect(urls.filter(url => url.includes("/commits/"))).toEqual(["https://api.github.com/repos/Azrkiel/albert/commits/moving%2Fbranch"]);
  for (const url of urls.slice(1)) expect(new URL(url).searchParams.get("ref")).toBe(SHA);
  expect(urls).toContain(`https://api.github.com/repos/Azrkiel/albert/contents/seed/calc2/pdf/unit-1/lecture-05.pdf?ref=${SHA}`);
  expect(urls.some(url => /answer|solution/i.test(url))).toBe(false);
});

it("upserts stable ids, reuses demo day after midnight, preserves ingestion and text caches", async () => {
  const repo = new MemoryRepo();
  const upsert = vi.spyOn(repo, "upsertCourse"), put = vi.spyOn(repo, "putFile");
  const noDay = { ...config, demoDay: undefined };
  const first = await importGitHubCourse(repo, noDay, { transport: recordedTransport(), now: new Date("2026-12-31T23:59:00Z") });
  const outline = await repo.getOutline(first.id);
  const id = sourceFileId(first.id, fixtureManifest().files[0]!.path);
  const file = (await repo.getFile(id))!;
  await repo.putFile({ ...file.meta, textCacheId: "p6-text" }, file.bytes);
  await repo.upsertCourse({ ...first, ingestedAt: "2026-12-31T23:59:30Z" });
  const second = await importGitHubCourse(repo, noDay, { transport: recordedTransport(), now: new Date("2027-01-01T01:00:00Z") });
  expect(second.id).toBe(first.id);
  expect(second.snapshot?.demoDay).toBe("2026-12-31");
  expect(await repo.getOutline(second.id)).toEqual(outline);
  expect(second.ingestedAt).toBe("2026-12-31T23:59:30Z");
  expect((await repo.getFile(id))?.meta.textCacheId).toBe("p6-text");
  expect(new Set(upsert.mock.calls.map(([c]) => c.id)).size).toBe(1);
  expect(new Set(put.mock.calls.map(([meta]) => meta.id)).size).toBe(12);
  const newDay = await importGitHubCourse(repo, { ...config, demoDay: "2027-01-01" }, { transport: recordedTransport() });
  expect(newDay.id).not.toBe(first.id);
  expect(newDay.unitIds.every(id => !first.unitIds.includes(id))).toBe(true);
});

it("new SHA, manifest path or manifest id produces a separate snapshot identity", () => {
  const snapshot = { owner: "o", repo: "r", commitSha: SHA, manifestPath: "manifest.json", demoDay: "2026-11-14" };
  const manifest = fixtureManifest();
  const original = normalizeManifest(manifest, snapshot).course.id;
  for (const changed of [{ ...snapshot, commitSha: "a".repeat(40) }, { ...snapshot, manifestPath: "other/manifest.json" }]) expect(normalizeManifest(manifest, changed).course.id).not.toBe(original);
  expect(normalizeManifest({ ...manifest, course: { ...manifest.course, id: "other" } }, snapshot).course.id).not.toBe(original);
});

it("sorts explicit unit order and handles UTC offsets across leap days and year boundaries", () => {
  const manifest = fixtureManifest();
  manifest.units.reverse();
  manifest.assignments[0]!.dueOffsetDays = -1;
  manifest.assignments[1]!.dueOffsetDays = 1;
  const result = normalizeManifest(manifest, { owner: "o", repo: "r", commitSha: SHA, manifestPath: "manifest.json", demoDay: "2028-02-29" });
  expect(result.outline.units.map(u => u.order)).toEqual([1, 2, 3, 4, 5]);
  expect(result.outline.assignments.slice(0, 2).map(a => a.dueAt)).toEqual(["2028-02-28T23:59:59Z", "2028-03-01T23:59:59Z"]);
});

it("cache-only adapter reads make zero transport calls; forged and missing references fail closed", async () => {
  const repo = new MemoryRepo(), transport = recordedTransport();
  const course = await importGitHubCourse(repo, config, { transport });
  transport.mockClear();
  transport.mockRejectedValue(new Error("disabled"));
  const adapter = await getAdapter(course.id, repo);
  expect(adapter.source).toBe("github");
  expect(await adapter.listCourses()).toEqual([{ id: course.id, title: course.title, shortName: "CALC2" }]);
  const outline = await adapter.getOutline(course.id);
  const ref = outline.units[0]!.files[0]!;
  expect((await adapter.downloadFile(ref)).mime).toBe("application/pdf");
  await expect(adapter.getOutline("wrong-course")).rejects.toMatchObject({ code: "not_found" });
  await expect(adapter.downloadFile({ ...ref, url: "https://evil.test/file" })).rejects.toMatchObject({ code: "not_found" });
  vi.spyOn(repo, "getFile").mockResolvedValue(null);
  await expect(adapter.downloadFile(ref)).rejects.toMatchObject({ code: "not_found" });
  expect(transport).not.toHaveBeenCalled();
});

const broken: Array<[string, (m: CourseManifest) => void]> = [
  ["traversal", m => { m.files[0]!.path = "../x.pdf"; }],
  ["absolute path", m => { m.files[0]!.path = "/x.pdf"; }],
  ["URL", m => { m.files[0]!.path = "https://evil.test/x.pdf"; }],
  ["percent escape", m => { m.files[0]!.path = "%2e%2e/x.pdf"; }],
  ["backslash", m => { m.files[0]!.path = "a\\x.pdf"; }],
  ["control character", m => { m.files[0]!.path = "a\nx.pdf"; }],
  ["dot segment", m => { m.files[0]!.path = "a/./x.pdf"; }],
  ["empty segment", m => { m.files[0]!.path = "a//x.pdf"; }],
  ["duplicate unit", m => { m.units.push(m.units[0]!); }],
  ["duplicate file", m => { m.files.push(m.files[0]!); }],
  ["duplicate assignment", m => { m.assignments.push(m.assignments[0]!); }],
  ["unknown unit", m => { m.files[0]!.unitOrder = 99; }],
  ["unknown reference", m => { m.assignments[0]!.filePaths = ["missing.pdf"]; }],
  ["wrong worksheet unit", m => { m.assignments[0]!.unitOrder = 2; }],
  ["non worksheet reference", m => { m.assignments[0]!.filePaths = [m.files[0]!.path]; }],
  ["empty worksheet reference", m => { m.assignments[0]!.filePaths = []; }],
  ["answer file", m => { m.files.push({ ...m.files[0]!, path: "answers.pdf" }); }],
  ["non PDF extension", m => { m.files[0]!.path = "notes.html"; }],
];

describe("safe import failures", () => {
  it.each(broken)("rejects %s before writes or PDF downloads", async (_label, mutate) => {
    const repo = new MemoryRepo(), write = vi.spyOn(repo, "putFile");
    const manifest = fixtureManifest(); mutate(manifest);
    expect(() => parseManifest(manifest)).toThrow(CourseSourceError);
    const transport = vi.fn<typeof fetch>(async input => String(input).includes("/commits/") ? Response.json({ sha: SHA }) : Response.json(manifest));
    await expect(importGitHubCourse(repo, config, { transport })).rejects.toMatchObject({ code: "bad_reply" });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
    expect(await repo.getConnection("demo")).toBeNull();
  });
  it.each([
    [404, {}, "not_found"], [401, {}, "forbidden"], [403, {}, "forbidden"],
    [403, { "x-ratelimit-remaining": "0" }, "rate_limited"],
    [403, { "retry-after": "30" }, "rate_limited"], [429, {}, "rate_limited"], [500, {}, "unavailable"],
  ] as const)("maps HTTP %i safely (%j)", async (status, headers, code) => {
    const repo = new MemoryRepo();
    const transport = vi.fn<typeof fetch>(async () => new Response("secret-token", { status, headers }));
    await expect(importGitHubCourse(repo, { ...config, token: "secret-token" }, { transport })).rejects.toMatchObject({ code });
    try { await importGitHubCourse(repo, config, { transport }); } catch (e) { expect(String(e)).not.toContain("secret-token"); }
    expect(await repo.getConnection("demo")).toBeNull();
  });
  it("sanitizes transport failures and keeps the previous connection usable", async () => {
    const repo = new MemoryRepo();
    const first = await importGitHubCourse(repo, config, { transport: recordedTransport() });
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret-token in a URL"));
    await expect(importGitHubCourse(repo, { ...config, token: "secret-token" }, { transport })).rejects.toMatchObject({ code: "unavailable", message: "The course source is unavailable. Try again later." });
    expect((await repo.getConnection("demo"))?.courseId).toBe(first.id);
    expect((await repo.getCourse(first.id))?.ingestedAt).toBeUndefined();
  });
  it.each([
    ["application/pdf", "%PDF-1.4\nvalid transport" , true],
    ["application/octet-stream", "%PDF-1.4\nvalid transport", true],
    ["application/json", "%PDF-pretend", false],
    ["text/html", "%PDF-pretend", false], ["application/pdf", "{\"error\":true}", false],
    ["application/vnd.github.raw+json", "not a PDF", false], ["", "%PDF-1.4", false],
  ])("checks MIME %s and PDF signature", async (mime, content, accepted) => {
    const repo = new MemoryRepo();
    const recorded = recordedTransport();
    const transport: typeof fetch = async (input, init) => {
      if (String(input).includes(".pdf?")) return new Response(String(content), { headers: { "Content-Type": String(mime) } });
      return recorded(input, init);
    };
    if (accepted) await expect(importGitHubCourse(repo, config, { transport })).resolves.toBeDefined();
    else {
      const put = vi.spyOn(repo, "putFile");
      await expect(importGitHubCourse(repo, config, { transport })).rejects.toMatchObject({ code: "bad_reply" });
      expect(put).not.toHaveBeenCalled();
      expect(await repo.getConnection("demo")).toBeNull();
    }
  });
  it.each(["{", JSON.stringify({ sha: "main" })])("rejects malformed commit replies", async body => {
    await expect(importGitHubCourse(new MemoryRepo(), config, { transport: vi.fn<typeof fetch>(async () => new Response(body)) })).rejects.toMatchObject({ code: "bad_reply" });
  });
  it("rejects invalid configured paths and dates", async () => {
    for (const changed of [{ ...config, manifestPath: "../manifest.json" }, { ...config, demoDay: "2026-02-30" }, { ...config, repository: "o/.." }]) {
      await expect(importGitHubCourse(new MemoryRepo(), changed, { transport: recordedTransport() })).rejects.toMatchObject({ code: "bad_reply" });
    }
  });
  it("does not expose a connection or ingestion completion on persistence failure", async () => {
    const repo = new MemoryRepo();
    vi.spyOn(repo, "saveOutline").mockRejectedValue(new Error("secret-token"));
    const courseWrite = vi.spyOn(repo, "upsertCourse");
    await expect(importGitHubCourse(repo, config, { transport: recordedTransport() })).rejects.toMatchObject({ code: "unavailable" });
    expect(await repo.getConnection("demo")).toBeNull();
    expect(courseWrite).not.toHaveBeenCalled();
  });
});

it.each([
  ["Lecture notes", "application/pdf", "lecture_notes"], ["Worksheet 3", "application/pdf", "worksheet"],
  ["HW 2", "application/pdf", "worksheet"], ["Problem set", "application/pdf", "worksheet"],
  ["Syllabus", "application/pdf", "syllabus"], ["Slides", "application/pdf", "slides"],
  ["Talk", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides"],
  ["Attachment", "application/pdf", "other"],
])("classifies %s", (title, mime, kind) => expect(guessKind(title, mime)).toBe(kind));


it("snapshot identity escapes the manifest/course separator without collisions", () => {
  const snapshot = { owner: "o", repo: "r", commitSha: SHA, manifestPath: "a~b", demoDay: "2026-11-14" };
  const manifest = fixtureManifest();
  const first = normalizeManifest({ ...manifest, course: { id: "c", title: "T" } }, snapshot).course.id;
  const second = normalizeManifest({ ...manifest, course: { id: "b~c", title: "T" } }, { ...snapshot, manifestPath: "a" }).course.id;
  expect(first).not.toBe(second);
});

it("a late PDF failure makes no cache or course writes and preserves the previous connection", async () => {
  const repo = new MemoryRepo();
  const original = await importGitHubCourse(repo, config, { transport: recordedTransport() });
  const put = vi.spyOn(repo, "putFile"), courseWrite = vi.spyOn(repo, "upsertCourse");
  const recorded = recordedTransport();
  const transport: typeof fetch = (input, init) => String(input).includes("worksheet-4.pdf")
    ? Promise.resolve(new Response("private upstream error", { status: 404 })) : recorded(input, init);
  await expect(importGitHubCourse(repo, { ...config, demoDay: "2026-11-15" }, { transport })).rejects.toMatchObject({ code: "not_found" });
  expect(put).not.toHaveBeenCalled();
  expect(courseWrite).not.toHaveBeenCalled();
  expect((await repo.getConnection("demo"))?.courseId).toBe(original.id);
});


it("encodes real live PDF paths with spaces and preserves the confirmed live mapping", async () => {
  const transport = recordedTransport(true);
  await importGitHubCourse(new MemoryRepo(), liveConfig, { transport });
  const urls = transport.mock.calls.map(([url]) => String(url));
  expect(urls).toContain(`https://api.github.com/repos/Azrkiel/albert-files/contents/lecture%20notes/7.4%20annotated.pdf?ref=${LIVE_SHA}`);
  expect(urls).toContain(`https://api.github.com/repos/Azrkiel/albert-files/contents/worksheets/Worksheet%207.2%20-%20Trigonometric%20Integrals%20(1).pdf?ref=${LIVE_SHA}`);
});
