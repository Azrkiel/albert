import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "../../src/lib/contracts";
import { examples } from "./contracts.examples";

export const REQUIRED_SCHEMAS = [
  "BBox", "Point", "Stroke", "Row", "Cluster", "SessionEvent", "StuckSignal",
  "Rung", "HintRequest", "HintTurn", "AlbertReply", "ReadWork", "Diagnose", "Mark",
  "WriteHint", "InkSegment", "HintEvent", "AlbertMarkSpec", "HintErrorCode", "AlbertMark",
  "CheckRequest", "Verdict", "CheckResponse", "Course", "CourseFile", "TeachingCard",
  "Worksheet", "ScopeBundle", "Outcome", "EvidenceEvent", "SkillLevel", "SkillState",
  "TutorReport", "StudyPlan", "PlanItem", "AgentRun", "AgentEvent", "GitHubSnapshot",
  "CourseConnection", "Session", "StoredHint", "CourseOutline", "FileRef", "CourseManifest",
  "SessionRecording", "MockHint", "EvalCase",
] as const;
const runtime: Record<string, unknown> = contracts;
const cases: Record<(typeof REQUIRED_SCHEMAS)[number], { valid: unknown; invalid: unknown }> = examples;

function schemaFor(name: string): z.ZodType {
  const schema = runtime[`${name}Schema`];
  if (!(schema instanceof z.ZodType)) throw new Error(`Missing schema: ${name}`);
  return schema;
}

// Exact table from contracts.md §14. Unknown JSON must not silently escape validation.
function fixtureSchema(path: string): string | null {
  if (path === "github/commit.json" || path.startsWith("github/files/") || path === "eval/last-run.json") return null;
  if ((path === "github/manifest.json" || path === "github/live-manifest.json")) return "CourseManifest";
  const folders: Record<string, string> = {
    sessions: "SessionRecording", llm: "MockHint", "eval/requests": "HintRequest",
    "eval/cases": "EvalCase", cards: "TeachingCard", worksheets: "Worksheet",
    plans: "StudyPlan", agent: "AgentRun",
  };
  const folder = path.slice(0, path.lastIndexOf("/"));
  const name = folders[folder];
  if (!name) throw new Error(`Unmapped JSON fixture: ${path}`);
  return name;
}

function validateFixtures(root: string): number {
  let count = 0;
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(dir, entry.name);
      const path = relative(root, file).replaceAll("\\", "/");
      if (path === "github/files") continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const name = fixtureSchema(path);
        if (name === null) continue;
        try {
          schemaFor(name).parse(JSON.parse(readFileSync(file, "utf8")));
          count++;
        } catch (error) {
          throw new Error(`Invalid fixture ${path} (${name})`, { cause: error });
        }
      }
    }
  }
  visit(root);
  return count;
}

describe("contract completeness", () => {
  // These checks start six Node processes / a TypeScript compiler; allow
  // cold Windows starts without changing any contract assertions.
  it("initializes contract modules regardless of entry point", () => {
    for (const name of ["hints", "check", "events", "course", "storage", "lms"]) {
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import './src/lib/contracts/${name}.ts'`], { cwd: resolve("."), stdio: "pipe" });
    }
  }, 30000);
  it("tracks every named data type in contracts.md and exports a Zod schema", () => {
    const doc = readFileSync(resolve("docs/plan/contracts.md"), "utf8");
    const names = [...doc.matchAll(/^type (\w+)\s*=/gm)].map((match) => match[1]);
    expect([...REQUIRED_SCHEMAS].sort()).toEqual(names.sort());
    for (const name of REQUIRED_SCHEMAS) expect(schemaFor(name)).toBeInstanceOf(z.ZodType);
    expect(Object.keys(runtime).filter((name) => name.endsWith("Schema")).sort()).toEqual(REQUIRED_SCHEMAS.map((name) => `${name}Schema`).sort());
    expect(Object.keys(examples).sort()).toEqual([...REQUIRED_SCHEMAS].sort());
  });

  it("keeps service interfaces compile-time only and matches their documented signatures", () => {
    // Compare the public types to the literal interfaces from the plan with the TS compiler.
    const doc = readFileSync(resolve("docs/plan/contracts.md"), "utf8");
    const blocks = [...doc.matchAll(/interface (?:Repo|CourseSourceAdapter) \{[\s\S]*?^\}/gm)].map((m) => m[0]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("putText(id: string, text: string): Promise<void>");
    expect(blocks[0]).toContain("getText(id: string): Promise<string | null>");
    const dir = mkdtempSync(join(resolve("tests/unit"), ".contract-types-"));
    try {
      const file = join(dir, "interfaces.ts");
      const names = REQUIRED_SCHEMAS.join(", ");
      writeFileSync(file, `import type { ${names}, Repo as ActualRepo, CourseSourceAdapter as ActualAdapter } from '../../../src/lib/contracts';\ntype ISO = string;\n${blocks.join("\n")}\ntype Assert<T extends true> = T;\ntype R1 = Assert<ActualRepo extends Repo ? true : false>;\ntype R2 = Assert<Repo extends ActualRepo ? true : false>;\ntype A1 = Assert<ActualAdapter extends CourseSourceAdapter ? true : false>;\ntype A2 = Assert<CourseSourceAdapter extends ActualAdapter ? true : false>;`);
      const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    expect(runtime.Repo).toBeUndefined();
    expect(runtime.CourseSourceAdapter).toBeUndefined();
  }, 30000);
});

describe("manifest validation", () => {
  const schema = () => schemaFor("CourseManifest");
  const manifest = examples.CourseManifest.valid;
  it.each(["../secret.pdf", "/absolute.pdf", "https://example.org/file.pdf", "//host/file.pdf", "C:/file.pdf", "folder\\file.pdf", "./file.pdf", "folder/../file.pdf", "folder//file.pdf", "folder/", "folder/%2e%2e/file.pdf", "file.pdf?token=secret", "file.pdf#fragment", "file\u0000.pdf"])("rejects unsafe repository path %j", (path) => {
    expect(schema().safeParse({ ...manifest, files: [{ ...manifest.files[0], path }] }).success).toBe(false);
  });
  it("preserves course-wide files, lecture labels and empty future units", () => {
    expect(schema().parse(manifest)).toEqual(manifest);
  });
  it.each([
    { ...manifest, units: [...manifest.units, manifest.units[0]] },
    { ...manifest, files: [...manifest.files, manifest.files[0]] },
    { ...manifest, assignments: [...manifest.assignments, manifest.assignments[0]] },
    { ...manifest, files: [{ ...manifest.files[0], unitOrder: 99 }] },
    { ...manifest, assignments: [{ ...manifest.assignments[0], unitOrder: 99 }] },
    { ...manifest, assignments: [{ ...manifest.assignments[0], filePaths: ["missing.pdf"] }] },
    { ...manifest, assignments: [{ ...manifest.assignments[0], dueOffsetDays: 1.5 }] },
    { ...manifest, files: [{ ...manifest.files[0], mime: "text/plain" }] },
  ])("rejects duplicate keys, dangling references and invalid field constraints: %#", (data) => {
    expect(schema().safeParse(data).success).toBe(false);
  });
  it("allows unscheduled assignments and negative integer offsets", () => {
    expect(schema().safeParse({ ...manifest, assignments: [{ id: "past", title: "Past work", unitOrder: 1, filePaths: [], dueOffsetDays: -2 }, { id: "unscheduled", title: "Extra work", unitOrder: 2, filePaths: [] }] }).success).toBe(true);
  });
});

describe("contract variants and bounds", () => {
  it("R2.1: preserves optional worksheet regions and rejects invalid page/box geometry", () => {
    const worksheet = examples.Worksheet.valid;
    const problem = worksheet.problems[0];
    const withRegion = (region: unknown) => ({ ...worksheet, problems: [{ ...problem, region }] });
    const region = { page: 2, bbox: { x: 0, y: 200, w: 1200, h: 400 } };
    expect(contracts.WorksheetSchema.parse(withRegion(region)).problems[0]!.region).toEqual(region);
    expect(contracts.WorksheetSchema.parse(worksheet)).toEqual(worksheet);
    for (const invalid of [{ ...region, page: 0 }, { ...region, page: 1.5 }, { page: 1, bbox: { x: 0, y: 0, w: -1, h: 1 } }]) {
      expect(contracts.WorksheetSchema.safeParse(withRegion(invalid)).success).toBe(false);
    }
  });
  it("matches the plan constants", () => {
    expect(contracts.PAGE).toEqual({ width: 1200, studentCol: { x: 0, w: 760 }, gutter: { x: 760, w: 30 }, albertCol: { x: 790, w: 410 }, rowHeight: 128, rowPaddingTop: 10, statementMinHeight: 96 });
    expect(contracts.INK).toEqual({ student: "#1b1b1f", albert: "#c8321e", clusterLabel: "#2f6fdb" });
    expect(contracts.STUCK).toEqual({ PAUSE_MIN_MS: 8000, PAUSE_MAX_MS: 20000, PAUSE_FACTOR: 2.5, ERASE_LOOP_COUNT: 2, ERASE_LOOP_WINDOW_MS: 45000, CROSS_OUT_COVERAGE: 0.6, CROSS_OUT_MIN_LENGTH_RATIO: 1.2, REARM_ON: "new_ink", CLUSTER_GAP: 4 });
  });
  it("accepts every session event variant", () => {
    const events = [examples.SessionEvent.valid, { type: "erase", at: 1, rowId: "r1", strokeIds: [] }, { type: "undo", at: 2, rowId: "r1", strokeIds: [] }, { type: "stuck", at: 3, signal: examples.StuckSignal.valid }, { type: "hint_requested", at: 4, hintId: "h1", rowId: "r1", rung: 3 }, { type: "hint_shown", at: 5, hintId: "h1", marks: [examples.AlbertMark.valid] }, { type: "check_requested", at: 6, problemId: "p1" }, { type: "check_result", at: 7, problemId: "p1", verdict: "correct" }, { type: "problem_opened", at: 8, problemId: "p1" }];
    for (const event of events) expect(schemaFor("SessionEvent").safeParse(event).success).toBe(true);
  });
  it("accepts every hint stream variant, including server-resolved arrows", () => {
    const events = [examples.HintEvent.valid, { type: "reading", rows: [{ rowId: "r1", latex: "x", confidence: "high" }] }, { type: "diagnosis", status: "on_track", inScope: true }, { type: "mark", mark: { type: "arrow", toRowId: "r1", toClusterIds: ["c1"] } }, { type: "hint", ...examples.WriteHint.valid }, { type: "done", hintId: "h1", ms: { firstEvent: 1, total: 10 } }, { type: "error", code: "timeout", message: "Try again." }];
    for (const event of events) expect(schemaFor("HintEvent").safeParse(event).success).toBe(true);
  });
  it("accepts all model mark and ink segment variants", () => {
    for (const type of ["circle", "underline", "cross_out"]) {
      expect(schemaFor("Mark").safeParse({ type, rowIndex: 1, clusterLabels: [1] }).success).toBe(true);
      expect(schemaFor("AlbertMarkSpec").safeParse({ type, rowId: "r1", clusterIds: ["c1"] }).success).toBe(true);
    }
    expect(schemaFor("Mark").safeParse({ type: "arrow", fromHint: true, toRowIndex: 1, toClusterLabels: [1] }).success).toBe(true);
    for (const segment of [{ type: "text", text: "Try" }, { type: "math", latex: "x" }, { type: "break" }]) expect(schemaFor("InkSegment").safeParse(segment).success).toBe(true);
    expect(schemaFor("AlbertMark").safeParse({ ...examples.AlbertMark.valid, spec: { type: "writing", rowId: "r1", segments: [{ type: "break" }], citation: "Lecture 1" } }).success).toBe(true);
  });
  it("accepts upload courses and connections without a GitHub snapshot", () => {
    expect(schemaFor("Course").safeParse({ id: "upload:1", source: "upload", title: "Uploaded", unitIds: [] }).success).toBe(true);
    expect(schemaFor("CourseConnection").safeParse({ studentId: "demo", connectedAt: "2026-11-13T12:00:00Z", source: "upload", courseId: "upload:1" }).success).toBe(true);
  });
  it("keeps token fields out of parsed persisted connections", () => {
    expect(schemaFor("CourseConnection").parse({ ...examples.CourseConnection.valid, token: "redacted" })).toEqual(examples.CourseConnection.valid);
  });
  it.each(["2026-02-30", "2026-13-01", "today", "2026-11-13T12:00:00Z"])("rejects invalid demo day %s", (demoDay) => {
    expect(schemaFor("GitHubSnapshot").safeParse({ ...examples.GitHubSnapshot.valid, demoDay }).success).toBe(false);
  });
  it("enforces card, worksheet and numeric bounds", () => {
    expect(schemaFor("TeachingCard").safeParse({ ...examples.TeachingCard.valid, subskills: [] }).success).toBe(false);
    expect(schemaFor("TeachingCard").safeParse({ ...examples.TeachingCard.valid, subskills: Array(9).fill(examples.TeachingCard.valid.subskills[0]) }).success).toBe(false);
    for (const estMinutes of [5, 45]) expect(schemaFor("PlanItem").safeParse({ ...examples.PlanItem.valid, estMinutes }).success).toBe(true);
    for (const estMinutes of [4, 46]) expect(schemaFor("PlanItem").safeParse({ ...examples.PlanItem.valid, estMinutes }).success).toBe(false);
    for (const p of [0, 1]) expect(schemaFor("Point").safeParse({ ...examples.Point.valid, p }).success).toBe(true);
    expect(schemaFor("Point").safeParse({ ...examples.Point.valid, x: Infinity }).success).toBe(false);
  });
});

describe("contract examples", () => {
  for (const name of REQUIRED_SCHEMAS) {
    it(`${name} accepts its valid example`, () => { expect(schemaFor(name).safeParse(cases[name].valid).success).toBe(true); });
    it(`${name} rejects its invalid example`, () => { expect(schemaFor(name).safeParse(cases[name].invalid).success).toBe(false); });
  }
});

describe("fixture validation", () => {
  it("validates all recorded JSON fixtures", () => { validateFixtures(resolve("fixtures")); });
  it("P3.1-AC1: every mock has one delay per event and ends in done; requests parse as HintRequest", () => {
    const mocks = readdirSync(resolve("fixtures/llm")).filter((file) => file.endsWith(".json"));
    expect(mocks.length).toBeGreaterThanOrEqual(6);
    for (const file of mocks) {
      const mock = contracts.MockHintSchema.parse(JSON.parse(readFileSync(resolve("fixtures/llm", file), "utf8")));
      expect(mock.delaysMs, file).toHaveLength(mock.events.length);
      // P3.8 error mocks (error-*.json) end in the error event; every other mock ends in done.
      expect(mock.events.at(-1)?.type, file).toBe(file.startsWith("error-") ? "error" : "done");
    }
    const requests = readdirSync(resolve("fixtures/eval/requests")).filter((file) => file.endsWith(".json"));
    expect(requests).toContain("missing-dx-r1.json");
    for (const file of requests) contracts.HintRequestSchema.parse(JSON.parse(readFileSync(resolve("fixtures/eval/requests", file), "utf8")));
  });
  function withFixtures(run: (root: string, put: (path: string, content: string) => void) => void) {
    const root = mkdtempSync(join(tmpdir(), "albert-contracts-"));
    try {
      run(root, (path, content) => {
        const target = join(root, path);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, content);
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  it("accepts an empty fixture tree", () => withFixtures((root) => { expect(validateFixtures(root)).toBe(0); }));
  it("parses every schema folder and skips the none entries without reading their contents", () => withFixtures((root, put) => {
    const paths = { "sessions/example.json": "SessionRecording", "llm/example.json": "MockHint", "eval/requests/example.json": "HintRequest", "eval/cases/example.json": "EvalCase", "cards/example.json": "TeachingCard", "worksheets/example.json": "Worksheet", "plans/example.json": "StudyPlan", "agent/example.json": "AgentRun", "github/manifest.json": "CourseManifest" } as const;
    for (const [path, name] of Object.entries(paths)) put(path, JSON.stringify(cases[name].valid));
    put("github/commit.json", "not JSON");
    put("github/files/ignored.json", "not JSON");
    put("eval/ping.png", "not an image");
    expect(validateFixtures(root)).toBe(9);
  }));
  it("fails at the first invalid fixture with its path and schema", () => withFixtures((root, put) => {
    put("cards/a.json", JSON.stringify(examples.TeachingCard.invalid));
    put("cards/b.json", "bad JSON");
    expect(() => validateFixtures(root)).toThrow("Invalid fixture cards/a.json (TeachingCard)");
  }));
  it("rejects malformed JSON", () => withFixtures((root, put) => { put("llm/bad.json", "bad JSON"); expect(() => validateFixtures(root)).toThrow("Invalid fixture llm/bad.json (MockHint)"); }));
  it("rejects unmapped JSON", () => withFixtures((root, put) => { put("unknown/data.json", "{}"); expect(() => validateFixtures(root)).toThrow("Unmapped JSON fixture"); }));
});
