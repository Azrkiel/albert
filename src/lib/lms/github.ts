import {
  CourseManifestSchema, CourseOutlineSchema, CourseSchema, GitHubSnapshotSchema,
  type Course, type CourseFile, type CourseManifest, type CourseOutline,
  type CourseSourceAdapter, type FileRef, type GitHubSnapshot, type Repo,
} from "../contracts";
import { CourseSourceError } from "./adapter";

export interface GitHubSourceConfig {
  repository: string;
  ref: string;
  manifestPath: string;
  demoDay?: string;
  token?: string;
}
export interface ImportOptions {
  transport?: typeof fetch;
  now?: Date;
  studentId?: string;
}

/** Server configuration only: never return this object from a route. */
export function configuredGitHubSource(env: NodeJS.ProcessEnv = process.env): GitHubSourceConfig {
  return {
    repository: env.COURSE_GITHUB_REPO || "Azrkiel/albert-files",
    ref: env.COURSE_GITHUB_REF || "main",
    manifestPath: env.COURSE_MANIFEST_PATH || "manifest.json",
    demoDay: env.COURSE_DEMO_DAY || undefined,
    token: env.COURSE_GITHUB_TOKEN || undefined,
  };
}

function encodeComponent(value: string): string {
  try { return encodeURIComponent(value).replaceAll("~", "%7E"); }
  catch { throw new CourseSourceError("bad_reply"); }
}
const encodePath = (path: string) => path.split("/").map(encodeComponent).join("/");
export const manifestCacheId = (courseId: string) => `${courseId}/manifest`;
export const sourceFileId = (courseId: string, path: string) => `${courseId}/f/${encodeURIComponent(path)}`;
export const cachedFileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;

function dueDate(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999 || date.getUTCFullYear() < 0) throw new CourseSourceError("bad_reply");
  return `${date.toISOString().slice(0, 10)}T23:59:59Z`;
}

/** Pure normalization; clock, network and storage are supplied by the import boundary. */
export function normalizeManifest(manifest: CourseManifest, snapshot: GitHubSnapshot): { course: Course; outline: CourseOutline } {
  const id = `github:${snapshot.owner}/${snapshot.repo}:${encodeComponent(snapshot.manifestPath)}~${encodeComponent(manifest.course.id)}:${snapshot.commitSha}:${snapshot.demoDay}`;
  const refs = new Map(manifest.files.map(file => [file.path, {
    title: file.title, mime: file.mime, kindGuess: file.kind,
    url: cachedFileUrl(sourceFileId(id, file.path)),
    ...(file.lectureLabel === undefined ? {} : { lectureLabel: file.lectureLabel }),
  } satisfies FileRef]));
  const units = [...manifest.units].sort((a, b) => a.order - b.order).map(unit => ({
    ...unit, sectionId: `${id}/u${unit.order}`,
    files: manifest.files.filter(file => file.unitOrder === unit.order).map(file => refs.get(file.path)!),
  }));
  const outline = CourseOutlineSchema.parse({
    course: { id, title: manifest.course.title }, units,
    files: manifest.files.filter(file => file.unitOrder === undefined).map(file => refs.get(file.path)!),
    assignments: manifest.assignments.map(assignment => ({
      id: `${id}/a/${encodeURIComponent(assignment.id)}`, title: assignment.title, unitOrder: assignment.unitOrder,
      fileRefs: assignment.filePaths.map(path => refs.get(path)!),
      ...(assignment.dueOffsetDays === undefined ? {} : { dueAt: dueDate(snapshot.demoDay, assignment.dueOffsetDays) }),
    })),
  });
  const course = CourseSchema.parse({ ...manifest.course, id, source: "github", snapshot, unitIds: units.map(unit => unit.sectionId) });
  return { course, outline };
}

/** Schema references plus semantic checks: a worksheet link must refer to its own unit. */
export function parseManifest(value: unknown): CourseManifest {
  const parsed = CourseManifestSchema.safeParse(value);
  if (!parsed.success) throw new CourseSourceError("bad_reply");
  const manifest = parsed.data;
  if (!manifest.course.id.trim() || !manifest.course.title.trim() || !manifest.units.length) throw new CourseSourceError("bad_reply");
  for (const file of manifest.files) {
    if (!/\.pdf$/i.test(file.path) || /answer|solution/i.test(file.path) || /answer|solution/i.test(file.title)) throw new CourseSourceError("bad_reply");
  }
  for (const assignment of manifest.assignments) {
    if (!assignment.id.trim() || !assignment.filePaths.length || new Set(assignment.filePaths).size !== assignment.filePaths.length) throw new CourseSourceError("bad_reply");
    for (const path of assignment.filePaths) {
      const file = manifest.files.find(file => file.path === path);
      if (!file || file.kind !== "worksheet" || file.unitOrder !== assignment.unitOrder) throw new CourseSourceError("bad_reply");
    }
  }
  return manifest;
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new CourseSourceError("bad_reply"); }
}

function checkPdf(bytes: Uint8Array, mime: string): void {
  // GitHub's negotiated raw contents API reports its vendor MIME even for PDF bytes.
  // Do not accept JSON/HTML error bodies or guess PDF solely from the filename.
  const accepted = ["application/pdf", "application/vnd.github.raw+json", "application/octet-stream"];
  if (!accepted.includes(mime.split(";", 1)[0]!.trim().toLowerCase()) ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new CourseSourceError("bad_reply");
}

/** The only GitHub network boundary. Readers below have no transport dependency. */
export async function importGitHubCourse(repo: Repo, config: GitHubSourceConfig, options: ImportOptions = {}): Promise<Course> {
  try {
    const match = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(config.repository);
    if (!match || !config.ref.trim()) throw new CourseSourceError("bad_reply");
    const owner = match[1]!, name = match[2]!;
    if (!GitHubSnapshotSchema.shape.manifestPath.safeParse(config.manifestPath).success) throw new CourseSourceError("bad_reply");
    const transport = options.transport ?? fetch;
    const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const request = async (url: string, raw = false): Promise<Response> => {
      let response: Response;
      try {
        response = await transport(url, {
          headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "User-Agent": "Albert-course-source", "X-GitHub-Api-Version": "2022-11-28", ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
          redirect: "error", signal: AbortSignal.timeout(30_000), cache: "no-store",
        });
      } catch { throw new CourseSourceError("unavailable"); }
      if (response.status === 404) throw new CourseSourceError("not_found");
      if (response.status === 429 || (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) throw new CourseSourceError("rate_limited");
      if (response.status === 401 || response.status === 403) throw new CourseSourceError("forbidden");
      if (!response.ok) throw new CourseSourceError("unavailable");
      return response;
    };
    const commit = await readJson(await request(`${base}/commits/${encodeURIComponent(config.ref)}`));
    const sha = typeof commit === "object" && commit !== null && "sha" in commit ? commit.sha : undefined;
    if (typeof sha !== "string" || !/^[a-f\d]{40}$/i.test(sha)) throw new CourseSourceError("bad_reply");
    const studentId = options.studentId ?? (process.env.DEMO_STUDENT_ID || "demo");
    const previousConnection = await repo.getConnection(studentId);
    const previous = previousConnection?.source === "github" ? previousConnection.snapshot : undefined;
    const sameSource = previous?.owner === owner && previous.repo === name && previous.manifestPath === config.manifestPath && previous.commitSha === sha.toLowerCase();
    const now = options.now ?? new Date();
    const day = config.demoDay ?? (sameSource ? previous.demoDay : now.toISOString().slice(0, 10));
    const checked = GitHubSnapshotSchema.safeParse({ owner, repo: name, commitSha: sha.toLowerCase(), manifestPath: config.manifestPath, demoDay: day });
    if (!checked.success) throw new CourseSourceError("bad_reply");
    const snapshot = checked.data;
    const contents = (path: string) => `${base}/contents/${encodePath(path)}?ref=${snapshot.commitSha}`;
    const manifestResponse = await request(contents(config.manifestPath), true);
    const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
    let json: unknown;
    try { json = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new CourseSourceError("bad_reply"); }
    const manifest = parseManifest(json);
    const { course, outline } = normalizeManifest(manifest, snapshot);
    const dir = config.manifestPath.includes("/") ? config.manifestPath.slice(0, config.manifestPath.lastIndexOf("/") + 1) : "";
    // Validate and download the entire snapshot before exposing a connection/course.
    const files: Array<{ meta: CourseFile; bytes: Uint8Array }> = [];
    for (const file of manifest.files) {
      const path = dir + file.path;
      const response = await request(contents(path), true);
      const bytes = new Uint8Array(await response.arrayBuffer());
      checkPdf(bytes, response.headers.get("content-type") ?? "");
      files.push({ bytes, meta: {
        id: sourceFileId(course.id, file.path), courseId: course.id,
        ...(file.unitOrder === undefined ? {} : { unitId: `${course.id}/u${file.unitOrder}` }),
        title: file.title, mime: "application/pdf", bytes: bytes.length, kind: file.kind,
        sourceUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${snapshot.commitSha}/${encodePath(path)}`,
      } });
    }
    for (const file of files) {
      const cached = await repo.getFile(file.meta.id);
      // Immutable snapshot ids permit reuse and preserve P6 textCacheId metadata.
      if (!cached) await repo.putFile(file.meta, file.bytes);
    }
    await repo.putFile({ id: manifestCacheId(course.id), courseId: course.id, title: "Source manifest", mime: "application/json", kind: "other", bytes: manifestBytes.length }, manifestBytes);
    await repo.saveOutline(outline);
    const existing = await repo.getCourse(course.id);
    // Only P6 may set ingestedAt; reimport must preserve that status and cached cards.
    if (existing?.ingestedAt) course.ingestedAt = existing.ingestedAt;
    await repo.upsertCourse(course);
    await repo.saveConnection({ source: "github", studentId, courseId: course.id, snapshot, connectedAt: now.toISOString() });
    return course;
  } catch (error) {
    if (error instanceof CourseSourceError) throw error;
    // No upstream error messages (including transport errors or secrets) leave this boundary.
    throw new CourseSourceError("unavailable");
  }
}

export class GitHubAdapter implements CourseSourceAdapter {
  readonly source = "github" as const;
  constructor(private readonly repo: Repo, private readonly courseId: string) {}

  async listCourses() {
    const course = await this.repo.getCourse(this.courseId);
    if (!course || course.source !== this.source) throw new CourseSourceError("not_found");
    return [{ id: course.id, title: course.title, ...(course.shortName === undefined ? {} : { shortName: course.shortName }) }];
  }
  async getOutline(courseId: string): Promise<CourseOutline> {
    if (courseId !== this.courseId) throw new CourseSourceError("not_found");
    const outline = await this.repo.getOutline(courseId);
    if (!outline) throw new CourseSourceError("not_found");
    return outline;
  }
  async downloadFile(ref: FileRef) {
    const outline = await this.getOutline(this.courseId);
    const listed = [...outline.files, ...outline.units.flatMap(unit => unit.files), ...outline.assignments.flatMap(assignment => assignment.fileRefs)];
    if (!listed.some(file => file.url === ref.url) || !ref.url.startsWith("/api/files/")) throw new CourseSourceError("not_found");
    let id: string;
    try { id = decodeURIComponent(ref.url.slice("/api/files/".length)); } catch { throw new CourseSourceError("bad_reply"); }
    const file = await this.repo.getFile(id);
    if (!file || file.meta.courseId !== this.courseId) throw new CourseSourceError("not_found");
    return { bytes: file.bytes, mime: file.meta.mime };
  }
}
