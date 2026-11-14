import { readFileSync } from "node:fs";
import { vi } from "vitest";
import { CourseManifestSchema } from "../../src/lib/contracts";

export const SHA: string = JSON.parse(readFileSync("fixtures/github/commit.json", "utf8")).sha;
export const LIVE_SHA: string = JSON.parse(readFileSync("fixtures/github/files/live-commit.json", "utf8")).sha;
export const fixtureManifest = (live = false) => CourseManifestSchema.parse(JSON.parse(readFileSync(`fixtures/github/${live ? "live-" : ""}manifest.json`, "utf8")));
export const config = { repository: "Azrkiel/albert", ref: "codex/p5.1-calc2-seed", manifestPath: "seed/calc2/manifest.json", demoDay: "2026-11-14" };
export const liveConfig = { ...config, repository: "Azrkiel/albert-files", ref: "codex/p5-course-manifest", manifestPath: "manifest.json" };

export function recordedTransport(live = false) {
  const manifest = fixtureManifest(live), source = live ? liveConfig : config;
  const dir = source.manifestPath.slice(0, source.manifestPath.lastIndexOf("/") + 1);
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith(`/repos/${source.repository}/`)) throw new Error("Wrong recorded repository");
    if (url.pathname.includes("/commits/")) return Response.json({ sha: live ? LIVE_SHA : SHA });
    if (url.searchParams.get("ref") !== (live ? LIVE_SHA : SHA)) throw new Error("Not pinned");
    const path = decodeURIComponent(url.pathname.split("/contents/")[1] ?? "");
    if (path === source.manifestPath) return Response.json(manifest);
    const relative = path.slice(dir.length);
    if (!path.startsWith(dir) || !manifest.files.some(f => f.path === relative)) throw new Error("Unlisted path");
    return new Response(readFileSync(`fixtures/github/files/${live ? "live" : "synthetic"}/${relative}`), { headers: { "Content-Type": "application/vnd.github.raw+json; charset=utf-8" } });
  });
}
