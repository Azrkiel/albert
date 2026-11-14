import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { CourseManifestSchema } from "../../src/lib/contracts";

const root = resolve("seed/calc2");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const manifest = CourseManifestSchema.parse(JSON.parse(read("manifest.json")));
const lecture = (unit: number, number: number) => read(`unit-${unit}/lecture-${String(number).padStart(2, "0")}.md`);
const l9 = lecture(3, 9);
const l10 = lecture(3, 10);
const units = [1, 2, 3, 4].map((u) => readdirSync(resolve(root, `unit-${u}`)).filter((f) => f.endsWith(".md")).map((f) => read(`unit-${u}/${f}`)).join("\n"));
const allContent = [read("syllabus.md"), read("answers.md"), ...units].join("\n");
const compact = (text: string) => text.replace(/\\,/g, "").replace(/\s/g, "");
const example = (text: string, label: string) => text.split(`## ${label}\n`)[1]?.split(/\n## /)[0] ?? "";

describe("P5.1-AC2: synthetic course marker facts", () => {
  it("M1: uses Leibniz derivatives throughout and never prime notation", () => {
    for (const text of [read("syllabus.md"), ...units]) expect(text).toContain("\\frac{dy}{dx}");
    expect(allContent).not.toMatch(/\b[a-zA-Z](?:['′’]|\\prime)|\\(?:phi|varphi|alpha|beta)\b/);
  });
  it("M2: teaches LIATE and the parts rule without a tabular method", () => {
    for (const n of [5, 6]) {
      const text = lecture(1, n);
      expect(text).toContain("LIATE");
      expect(compact(text)).toContain("\\intudv=uv-\\intvdu");
    }
    for (const word of ["Logarithmic", "Inverse trig", "Algebraic", "Trigonometric", "Exponential"]) expect(lecture(1, 5)).toContain(word);
    expect(units[0]).not.toMatch(/tabular|D\s*[-/]\s*I\s+table/i);
  });
  it("M3: Lecture 9 names all five steps in the specified order", () => {
    expect(l9).toContain("The five-step recipe");
    expect(l9).toMatch(/1\. Choose the substitution from the table\.[\s\S]*2\. Find \$dx\$\.[\s\S]*3\. Substitute and simplify with a Pythagorean identity\.[\s\S]*4\. Integrate in \$\\theta\$\.[\s\S]*5\. Draw the reference triangle and convert back to \$x\$\./);
  });
  it("M4: includes all three exact root-to-substitution pairs", () => {
    for (const [radical, substitution] of [["a^2-x^2", "sin"], ["a^2+x^2", "tan"], ["x^2-a^2", "sec"]]) {
      expect(compact(l9)).toContain(`$\\sqrt{${radical}}$|$x=a\\${substitution}\\theta$`);
    }
  });
  it("M5: always uses theta and actually draws reference triangles for conversion", () => {
    for (const text of [l9, l10]) {
      expect(text).toContain("The angle is always $\\theta$");
      expect(text).toContain("reference triangle");
      expect(text).toMatch(/(?:do not use|without) inverse-trig identities/);
      expect(text).not.toMatch(/x\s*=\s*\d*\s*\\(?:sin|cos|tan|sec)\s*(?:[tu]|\\(?:phi|alpha|beta))\b/);
      expect(text.match(/<svg class="triangle"/g)).toHaveLength(2);
      for (const n of [1, 2]) expect(example(text, `Lecture ${text === l9 ? 9 : 10}, Example ${n}`)).toContain("<svg class=\"triangle\"");
    }
  });
  it("M6: Lecture 9 Example 2 works the required integral through five labelled steps", () => {
    const text = example(l9, "Lecture 9, Example 2");
    expect(compact(text)).toContain("\\int\\frac{dx}{x^2\\sqrt{9-x^2}}");
    expect([...text.matchAll(/^### Step (\d):/gm)].map((m) => m[1])).toEqual(["1", "2", "3", "4", "5"]);
    expect(text).toMatch(/^### Step 2: find dx\n\n\$\$.*dx=3\\cos\\theta\\,d\\theta/m);
    expect(compact(text)).toContain("-\\frac{\\sqrt{9-x^2}}{9x}+C");
  });
  it("M7: Lecture 10 has tan and sec cases; Example 2 uses x = 3 sec theta", () => {
    expect(compact(example(l10, "Lecture 10, Example 1"))).toContain("x=2\\tan\\theta");
    const text = example(l10, "Lecture 10, Example 2");
    expect(compact(text)).toContain("x=3\\sec\\theta");
    expect([...text.matchAll(/^### Step (\d):/gm)].map((m) => m[1])).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("M8: reserves Partial Fractions for Unit 4 in the syllabus", () => {
    expect(read("syllabus.md")).toMatch(/\| 4 \| Partial Fractions \|/);
    for (const text of units.slice(0, 3)) expect(text).not.toMatch(/partial[\s-]+fractions?/i);
  });
});

describe("P5.1 course structure and integration handoff", () => {
  it("validates the shared manifest, five ordered units, and only the eleven student PDFs", () => {
    expect(manifest.course).toEqual({ id: "calc2", title: "Calculus II", shortName: "CALC2" });
    expect(manifest.units).toEqual(["Integration by Parts", "Trigonometric Integrals", "Trigonometric Substitution", "Partial Fractions", "Improper Integrals"].map((title, i) => ({ order: i + 1, title })));
    expect(manifest.files).toHaveLength(11);
    expect(manifest.files.filter((f) => f.kind === "syllabus")).toHaveLength(1);
    expect(manifest.files.filter((f) => f.kind === "worksheet")).toHaveLength(4);
    expect(manifest.files.filter((f) => f.kind === "lecture_notes").map((f) => [f.unitOrder, f.lectureLabel])).toEqual([[1, "Lecture 5"], [1, "Lecture 6"], [2, "Lecture 7"], [2, "Lecture 8"], [3, "Lecture 9"], [3, "Lecture 10"]]);
    expect(manifest.files.find((f) => f.kind === "syllabus")?.unitOrder).toBeUndefined();
    expect(manifest.files.some((f) => f.unitOrder === 5)).toBe(false);
    for (const f of manifest.files) {
      expect(f.path).toMatch(/^pdf\/(?:syllabus|unit-[1-4]\/(?:lecture-\d\d|worksheet-\d))\.pdf$/);
      expect(f.path).not.toMatch(/answers|verification/);
      expect(read(f.path.slice(4, -4) + ".md")).toMatch(/^# /);
    }
    expect(manifest.assignments.map((a) => [a.title, a.unitOrder, a.dueOffsetDays])).toEqual([["Worksheet 1", 1, undefined], ["Worksheet 2", 2, undefined], ["Worksheet 3", 3, 4], ["Worksheet 4", 4, 11]]);
    for (const a of manifest.assignments) expect(a.filePaths).toEqual(manifest.files.filter((f) => f.kind === "worksheet" && f.unitOrder === a.unitOrder).map((f) => f.path));
  });
  it("preserves all five Worksheet 3 statements and P3.2 page labels", () => {
    const text = read("unit-3/worksheet-3.md");
    const parts = text.split(/^## Problem \d\n/gm).slice(1);
    expect(parts).toHaveLength(5);
    const integrals = ["\\int\\frac{dx}{x^2\\sqrt{16-x^2}}", "\\int\\sqrt{25-x^2}dx", "\\int\\frac{dx}{(x^2+9)^{3/2}}", "\\int\\frac{dx}{x^2-9}", "\\int\\frac{x^3}{\\sqrt{x^2+4}}dx"];
    parts.forEach((part, i) => expect(compact(part)).toContain(integrals[i]));
    expect(parts[3]).toContain("x>3");
    expect(text.split("<!-- pagebreak -->")[0]?.match(/^## Problem/gm)).toHaveLength(3);
    expect(text.split("<!-- pagebreak -->")[1]?.match(/^## Problem/gm)).toHaveLength(2);
    for (const [n, content] of [[9, l9], [10, l10]] as const) {
      expect(content.split("<!-- pagebreak -->")[1]).toContain(`Lecture ${n}, Example 1`);
      expect(content.split("<!-- pagebreak -->")[2]).toContain(`Lecture ${n}, Example 2`);
    }
  });
  it("P5.1-AC3: records CAS evidence for every actual answer and detects stale sources", () => {
    const evidence = JSON.parse(read("answer-verification.json")) as { sourceSha256: Record<string, string>; results: { worksheet: number; problem: number; checks: { derivative_minus_integrand: string }[] }[] };
    for (const [path, hash] of Object.entries(evidence.sourceSha256)) expect(createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex"), path).toBe(hash);
    expect(Object.keys(evidence.sourceSha256).sort()).toEqual(["answers.md", ...[1, 2, 3, 4].map((n) => `unit-${n}/worksheet-${n}.md`)]);
    const answerGroups = read("answers.md").split(/^## Worksheet \d\n/gm).slice(1);
    expect(answerGroups).toHaveLength(4);
    for (let u = 1; u <= 4; u++) {
      const labels = [...read(`unit-${u}/worksheet-${u}.md`).matchAll(/^## Problem (\d+)$/gm)].map((m) => Number(m[1]));
      expect([...answerGroups[u - 1]!.matchAll(/^### Problem (\d+)$/gm)].map((m) => Number(m[1]))).toEqual(labels);
      expect(evidence.results.filter((r) => r.worksheet === u).map((r) => r.problem)).toEqual(labels);
    }
    expect(evidence.results).toHaveLength(14);
    for (const r of evidence.results) {
      expect(r.checks.length).toBeGreaterThan(0);
      for (const check of r.checks) expect(check.derivative_minus_integrand).toBe("0");
    }
  });
  it("P5.1-AC1: every committed PDF resolves, is under 4 MB / 10 pages, and matches source pagination", async () => {
    const build = JSON.parse(read("pdf-build.json")) as { generatorSha256: string; files: { path: string; sourceSha256: string; pdfSha256: string; pages: number; bytes: number }[] };
    expect(build.generatorSha256).toBe(createHash("sha256").update(readFileSync(resolve("scripts/seed-pdf.ts"))).digest("hex"));
    expect(build.files.map((f) => f.path)).toEqual(manifest.files.map((f) => f.path));
    const paths = readdirSync(resolve(root, "pdf"), { recursive: true }).filter((p) => String(p).endsWith(".pdf")).map((p) => "pdf/" + String(p).replaceAll("\\", "/"));
    expect(paths.sort()).toEqual(manifest.files.map((f) => f.path).sort());
    for (const file of manifest.files) {
      const bytes = readFileSync(resolve(root, file.path));
      const record = build.files.find((f) => f.path === file.path)!;
      expect(record.pdfSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(record.sourceSha256).toBe(createHash("sha256").update(read(file.path.slice(4, -4) + ".md")).digest("hex"));
      expect(record.bytes).toBe(bytes.byteLength);
      expect(bytes.byteLength).toBeLessThan(4_000_000);
      const pdf = await PDFDocument.load(bytes);
      expect(record.pages).toBe(pdf.getPageCount());
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(pdf.getPageCount()).toBeLessThan(10);
      expect(pdf.getPageCount()).toBe(read(file.path.slice(4, -4) + ".md").split("<!-- pagebreak -->").length);
    }
  });
});
