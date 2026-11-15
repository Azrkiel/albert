import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { CourseFileSchema, CourseManifestSchema, CourseOutlineSchema, CourseSchema, TeachingCardSchema, WorksheetSchema, type Repo } from "../src/lib/contracts";
import { getRepo } from "../src/lib/db";
import { getMongoClient } from "../src/lib/db/mongo";
import { importGitHubCourse } from "../src/lib/lms";
import { sourceFileId } from "../src/lib/lms/github";
import { fileIdFromRef, ingestFlat, IngestValidationError } from "../src/lib/agent/functions/ingest-flat";
import { checkIngest } from "../src/lib/agent/functions/check-ingest";

// Explicit local state for process-local STORE=memory. No credentials/connections.
const StateSchema = z.object({
  version: z.literal(1), course: CourseSchema, outline: CourseOutlineSchema,
  files: z.array(z.object({ meta: CourseFileSchema, base64: z.string(), text: z.string().optional() })),
  cards: z.array(TeachingCardSchema), worksheets: z.array(WorksheetSchema),
});
export function flag(args: string[], name: string): string | undefined {
  const n = args.indexOf(name);
  if (n < 0) return undefined;
  const value = args[n + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}
export const isMain = (url: string) => !!process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;

export async function closeScriptStore(): Promise<void> {
  if (process.env.STORE !== "memory" && process.env.MONGODB_URI) await getMongoClient(process.env.MONGODB_URI).close();
}

export async function openScriptStore(args: string[], allowLocal = false): Promise<{ repo: Repo; courseId: string; save: () => Promise<void> }> {
  const repo = getRepo();
  const source = flag(args, "--source");
  if (source && source !== "synthetic") throw new Error("Only --source synthetic is supported; import other courses through the source API.");
  const statePath = flag(args, "--state") ?? (source === "synthetic" && process.env.STORE === "memory" ? "work/p6.1-synthetic.json" : undefined);
  if (statePath && process.env.STORE !== "memory") throw new Error("--state is for STORE=memory only");
  let courseId = flag(args, "--course");
  if (statePath) {
    let saved: string | undefined;
    try { saved = await readFile(resolve(statePath), "utf8"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (saved !== undefined) {
      const state = StateSchema.parse(JSON.parse(saved));
      if (courseId && courseId !== "synthetic" && state.course.id !== courseId) throw new Error("State file belongs to another course.");
      courseId = state.course.id;
      await repo.upsertCourse(state.course);
      await repo.saveOutline(state.outline);
      for (const file of state.files) {
        await repo.putFile(file.meta, Buffer.from(file.base64, "base64"));
        if (file.meta.textCacheId && file.text !== undefined) await repo.putText(file.meta.textCacheId, file.text);
      }
      for (const card of state.cards) await repo.upsertCard(card);
      for (const worksheet of state.worksheets) await repo.upsertWorksheet(worksheet);
    }
  }
  if (source === "synthetic") {
    const manifest = CourseManifestSchema.parse(JSON.parse(await readFile("fixtures/github/manifest.json", "utf8")));
    const sha = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(JSON.parse(await readFile("fixtures/github/commit.json", "utf8"))).sha;
    const transport: typeof fetch = async input => {
      const url = new URL(String(input));
      if (!url.pathname.startsWith("/repos/Azrkiel/albert/")) throw new Error("Wrong recorded repository");
      if (url.pathname.includes("/commits/")) return Response.json({ sha });
      if (url.searchParams.get("ref") !== sha) throw new Error("Recorded request must be pinned");
      const path = decodeURIComponent(url.pathname.split("/contents/")[1] ?? "");
      if (path === "seed/calc2/manifest.json") return Response.json(manifest);
      const relative = path.replace(/^seed\/calc2\//, "");
      if (!manifest.files.some(f => f.path === relative)) throw new Error("Unlisted recorded file");
      return new Response(await readFile(`fixtures/github/files/synthetic/${relative}`), { headers: { "Content-Type": "application/pdf" } });
    };
    const course = await importGitHubCourse(repo, { repository: "Azrkiel/albert", ref: sha, manifestPath: "seed/calc2/manifest.json", demoDay: "2026-11-14" }, { transport });
    if (courseId && courseId !== "synthetic" && courseId !== course.id) throw new Error("--course does not match the recorded synthetic course");
    courseId = course.id;
  }
  if (!courseId && !allowLocal) throw new Error("Use --course <id> or --source synthetic --course synthetic");
  const save = async () => {
    if (!statePath || !courseId) return;
    const course = await repo.getCourse(courseId), outline = await repo.getOutline(courseId);
    if (!course || !outline) return;
    const refs = [...outline.files, ...outline.units.flatMap(u => u.files), ...outline.assignments.flatMap(a => a.fileRefs)];
    const files = [];
    for (const id of new Set(refs.map(fileIdFromRef))) {
      const file = await repo.getFile(id);
      if (!file) throw new Error(`Missing cached file ${id}; reimport the course source.`);
      const text = file.meta.textCacheId ? await repo.getText(file.meta.textCacheId) : null;
      files.push({ meta: file.meta, base64: Buffer.from(file.bytes).toString("base64"), ...(text === null ? {} : { text }) });
    }
    const state = StateSchema.parse({ version: 1, course, outline, files, cards: await repo.listCards(courseId), worksheets: await repo.listWorksheets(courseId) });
    const path = resolve(statePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  return { repo, courseId: courseId ?? "", save };
}

/** A path is explicitly imported at the CLI boundary, never fetched by readCourseFile. */
export async function importLocalPdf(repo: Repo, path: string): Promise<string> {
  const bytes = await readFile(path);
  const id = `local-pdf:${createHash("sha256").update(bytes).digest("hex")}`;
  if (!await repo.getFile(id)) await repo.putFile({ id, courseId: "local", title: path, mime: "application/pdf", bytes: bytes.length, kind: "lecture_notes" }, bytes);
  return id;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { repo, courseId, save } = await openScriptStore(args);
  const repeats = args.includes("--twice") ? 2 : 1;
  let initial: { cards: string[]; worksheets: string[] } | undefined;
  for (let n = 0; n < repeats; n++) {
    console.log(`Course: ${courseId}`);
    const result = await ingestFlat(courseId, { repo, checkpoint: save });
    await save();
    const ids = { cards: (await repo.listCards(courseId)).map(c => c.unitId).sort(), worksheets: (await repo.listWorksheets(courseId)).map(w => w.id).sort() };
    if (initial && JSON.stringify(ids) !== JSON.stringify(initial)) throw new Error("Second run changed artifact ids or counts");
    initial = ids;
    console.log(`Run ${n + 1}: ${result.cards} cards, ${result.worksheets} worksheets${n ? "; no duplicates" : ""}`);
    if (args.includes("--check")) for (const check of await checkIngest(courseId, repo)) {
      console.log(`${check.number}: ${check.status}${check.status === "skipped" ? ` (${check.detail})` : ` — ${check.detail}`}`);
      if (check.status === "fail") process.exitCode = 1;
    }
  }
}

// This import is also used by read-file's synthetic path resolver.
export { sourceFileId };
if (isMain(import.meta.url)) main().catch(error => {
  console.error(error instanceof IngestValidationError ? error.message : "Flat ingest failed; check model configuration and source cache. No provider error body is printed.");
  process.exitCode = 1;
}).finally(closeScriptStore);
