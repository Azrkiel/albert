import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SKILLS = ["teaching-card", "study-plan", "socratic-tutor"] as const;

function frontMatter(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(match, `${path} starts with front matter`).not.toBeNull();
  // Flat `key: value` lines, optionally double-quoted; enough for SKILL.md front matter.
  const out: Record<string, unknown> = {};
  for (const line of match![1]!.split("\n")) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

describe("P6.4 skills", () => {
  it.each(SKILLS)("%s has a name matching its folder and a description (AC1)", (skill) => {
    const meta = frontMatter(`skills/${skill}/SKILL.md`);
    expect(meta.name).toBe(skill);
    expect(typeof meta.description).toBe("string");
    expect((meta.description as string).length).toBeGreaterThan(20);
    expect((meta.description as string).length).toBeLessThanOrEqual(1024);
  });

  it("vendors the socratic tutor with its MIT licence (AC1)", () => {
    expect(existsSync("skills/socratic-tutor/LICENSE.md")).toBe(true);
    expect(readFileSync("skills/socratic-tutor/LICENSE.md", "utf8")).toContain("MIT");
  });

  it("keeps SKILL.md files LF-only so deepagents parses quoted front matter (.gitattributes)", () => {
    for (const skill of SKILLS) expect(readFileSync(`skills/${skill}/SKILL.md`, "utf8"), skill).not.toContain("\r");
  });

  it("teaching-card and study-plan carry the rules the validators enforce", () => {
    const card = readFileSync("skills/teaching-card/SKILL.md", "utf8");
    for (const phrase of ["never invent", "begin \"can", "snake_case", "empty steps", "save_teaching_card"]) expect(card.toLowerCase()).toContain(phrase.toLowerCase());
    const plan = readFileSync("skills/study-plan/SKILL.md", "utf8");
    for (const phrase of ["45 minutes", "two days after", "upcoming unit", "save_study_plan"]) expect(plan).toContain(phrase);
  });
});
