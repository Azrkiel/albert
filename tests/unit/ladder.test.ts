import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TeachingCardSchema, WorksheetSchema, type AlbertReply, type Diagnose, type Rung, type WriteHint } from "../../src/lib/contracts";
import { buildScopeBundle } from "../../src/lib/tutor/scope";
import { checkLadder, checkPointing, checkScope, checkUnreadable } from "../../src/lib/tutor/ladder";

const cards = [1, 2, 3, 4].map((n) => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8"))));
const worksheet = WorksheetSchema.parse(JSON.parse(readFileSync("fixtures/worksheets/calc2-ws3.json", "utf8")));
const scope = buildScopeBundle(worksheet, "calc2-ws3/p1", cards);
const diagnosis: Diagnose = { status: "error", privateNote: "Missing differential", subskillId: "u3.find_dx" };
const hint = (text: string, kind: WriteHint["kind"] = "question"): WriteHint => ({ kind, segments: [{ type: "text", text }] });

describe("P3.3-AC1 ladder rules", () => {
  it("rung 1 without ? fails", () => {
    expect(checkLadder(hint("What happened to dx"), diagnosis, 1)).toContain("Rung 1 must end with a question mark (?).");
  });
  it("rung 1 with 30 words fails", () => {
    expect(checkLadder(hint(`${"word ".repeat(29)}word?`), diagnosis, 1).join(" ")).toContain("at most 18 words; you used 30");
  });
  it("rung 2 with dx = 4\\cos\\theta\\,d\\theta fails", () => {
    const next: WriteHint = { kind: "next_step", segments: [{ type: "math", latex: String.raw`dx = 4\cos\theta\,d\theta` }] };
    expect(checkLadder(next, diagnosis, 2).join(" ")).toContain("must not contain =");
  });
  it.each([
    "Use partial fractions.",
    "Can partial fractions help?",
    "Partial fractions comes later. Use partial fractions now.",
    "Partial fractions comes later, so apply partial fractions.",
    "Partial fractions arrives in Unit 4 and use partial fractions now.",
  ])('"partial fractions" not in a deferring sentence fails: %s', (text) => {
    expect(checkScope(hint(text), diagnosis, scope)).toHaveLength(1);
  });
  it.each([
    "You'll meet partial fractions in Unit 4. What does dx become?",
    "Partial fractions is covered in Unit 4. Differentiate the substitution.",
  ])("permits an upcoming name in a deferring sentence: %s", (text) => {
    expect(checkScope(hint(text), diagnosis, scope)).toEqual([]);
  });
  it("unknown subskillId fails", () => {
    expect(checkScope(hint("What does dx become?"), { ...diagnosis, subskillId: "u99.invented" }, scope).join(" ")).toContain("Unknown subskillId");
  });
  it("unreadable with marks fails", () => {
    expect(checkUnreadable(hint("Please rewrite that row.", "reread"), { ...diagnosis, status: "unreadable" }, [
      { type: "circle", rowIndex: 3, clusterLabels: [1] },
    ])).toEqual(["Unreadable work must have no marks."]);
  });
  it.each([1, 2, 3] as Rung[])("passes a valid rung %i", (rung) => {
    const valid = rung === 1 ? hint("What does dx become?") : rung === 2 ? hint("Differentiate your substitution to find the differential.", "next_step") : {
      kind: "worked_step" as const, segments: [{ type: "math" as const, latex: String.raw`dx = 4\cos\theta\,d\theta` }],
    };
    expect(checkLadder(valid, diagnosis, rung)).toEqual([]);
  });
  it("enforces kinds, word limits and math-segment limits at every rung", () => {
    expect(checkLadder(hint("What now?", "worked_step"), diagnosis, 1).join(" ")).toContain("kind must be question or nudge");
    expect(checkLadder(hint("Name the step.", "question"), diagnosis, 2).join(" ")).toContain("kind must be next_step");
    expect(checkLadder(hint("One step.", "next_step"), diagnosis, 3).join(" ")).toContain("kind must be worked_step");
    expect(checkLadder(hint("word ".repeat(25), "next_step"), diagnosis, 2).join(" ")).toContain("at most 24 words");
    const math = [{ type: "math" as const, latex: "x" }, { type: "math" as const, latex: "y" }];
    expect(checkLadder({ kind: "question", segments: [...math, { type: "text", text: "?" }] }, diagnosis, 1).join(" ")).toContain("at most one math");
    expect(checkLadder({ kind: "worked_step", segments: [...math, ...math] }, diagnosis, 3).join(" ")).toContain("at most two math");
  });
  it("accepts the exact word limits and nudge kind", () => {
    expect(checkLadder(hint(`${"word ".repeat(17)}word?`, "nudge"), diagnosis, 1)).toEqual([]);
    expect(checkLadder(hint("word ".repeat(24), "next_step"), diagnosis, 2)).toEqual([]);
  });
  it.each([1, 2, 3] as Rung[])("unreadable forces reread instead of rung %i", (rung) => {
    const unreadable = { ...diagnosis, status: "unreadable" as const };
    const reread = hint("Please rewrite the last row.", "reread");
    expect(checkLadder(reread, unreadable, rung)).toEqual([]);
    expect(checkUnreadable(reread, unreadable, [])).toEqual([]);
    expect(checkUnreadable(hint("What now?"), unreadable, [])).toContain("Unreadable work requires hint kind reread.");
  });
  it("rejects unknown row references before mapping ids", () => {
    const reply: AlbertReply = { reading: { rows: [{ index: 99, latex: "x", confidence: "low" }] }, diagnosis: { ...diagnosis, rowIndex: 98 },
      marks: [{ type: "arrow", fromHint: true, toRowIndex: 97, toClusterLabels: [] }], hint: hint("What now?") };
    expect(checkPointing(reply, [{ rowId: "row3", index: 3, clusterLabels: [1] }])).toHaveLength(3);
  });
});
