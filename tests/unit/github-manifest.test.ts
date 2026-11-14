import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fixtureManifest } from "./github-fixtures";

describe("P5.2 recorded manifests", () => {
  it("validates synthetic transport and live course separately", () => {
    const synthetic = fixtureManifest();
    const live = fixtureManifest(true);
    expect(synthetic.units).toHaveLength(5);
    expect(synthetic.files.filter(f => f.kind === "lecture_notes")).toHaveLength(6);
    expect(synthetic.assignments).toHaveLength(4);
    expect(synthetic.files.filter(f => f.kind === "syllabus")).toHaveLength(1);
    expect(synthetic.course.title).toBe("Calculus II");
    expect(live.units.map(u => u.title)).toEqual(["Integration by Parts", "Trigonometric Integrals", "Trigonometric Substitution", "Partial Fractions"]);
    expect(live.files.filter(f => f.kind === "lecture_notes").map(f => f.lectureLabel)).toEqual(["Section 7.1", "Section 7.2", "Section 7.3", "Section 7.4"]);
    expect(live.files.some(f => f.kind === "syllabus")).toBe(false);
    expect(live.assignments.every(a => a.dueOffsetDays === undefined)).toBe(true);
  });
  it.each([false, true])("records every selected PDF and excludes answer files (live=%s)", live => {
    const manifest = fixtureManifest(live);
    for (const file of manifest.files) {
      expect(file.path).not.toMatch(/answer|solution/i);
      const bytes = readFileSync(`fixtures/github/files/${live ? "live" : "synthetic"}/${file.path}`);
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    }
    for (const assignment of manifest.assignments) {
      expect(assignment.filePaths).toHaveLength(1);
      const file = manifest.files.find(f => f.path === assignment.filePaths[0]);
      expect(file?.kind).toBe("worksheet");
      expect(file?.unitOrder).toBe(assignment.unitOrder);
    }
  });
});


it("consumes the P5.1 owner artifacts byte-for-byte with their published build evidence", () => {
  const build = JSON.parse(readFileSync("fixtures/github/files/synthetic-build.json", "utf8")) as { files: Array<{ path: string; pdfSha256: string; bytes: number }> };
  expect(build.files).toHaveLength(11);
  for (const evidence of build.files) {
    const bytes = readFileSync(`fixtures/github/files/synthetic/${evidence.path}`);
    expect(bytes.length).toBe(evidence.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(evidence.pdfSha256);
  }
});
