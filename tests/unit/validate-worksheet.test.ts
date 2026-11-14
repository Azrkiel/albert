import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { TeachingCardSchema, WorksheetSchema, type Worksheet } from "../../src/lib/contracts";
import { validateWorksheet } from "../../src/lib/agent/functions/extract-worksheet";
const cards = [1, 2, 3, 4].map(n => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8"))));
const fixture = (n = 3) => WorksheetSchema.parse(JSON.parse(readFileSync(`fixtures/worksheets/calc2-ws${n}.json`, "utf8")));
it.each([1, 3])("accepts hand-written Worksheet %i", n => expect(validateWorksheet(fixture(n), cards)).toEqual([]));
const broken: [string, (ws: Worksheet) => void][] = [
  ["upcoming subskill", ws => { ws.problems[0]!.subskillIds = [cards[3]!.subskills[0]!.id]; }],
  ["unknown subskill", ws => { ws.problems[0]!.subskillIds = ["no-such-skill"]; }],
  ["no subskills", ws => { ws.problems[0]!.subskillIds = []; }],
  ["duplicate labels", ws => { ws.problems[1]!.label = ws.problems[0]!.label; }],
  ["whitespace-equivalent labels", ws => { ws.problems[1]!.label = ` ${ws.problems[0]!.label} `; }],
  ["empty statement", ws => { ws.problems[0]!.statementLatex = "  "; }],
  ["empty label", ws => { ws.problems[0]!.label = " "; }],
  ["no problems", ws => { ws.problems = []; }],
  ["upcoming method", ws => { ws.problems[0]!.methodIds = [cards[3]!.methods[0]!.id]; }],
  ["unknown unit", ws => { ws.unitId = "missing"; }],
];
it.each(broken)("rejects %s", (_name, mutate) => { const ws = fixture(); mutate(ws); expect(validateWorksheet(ws, cards).length).toBeGreaterThan(0); });
it("rejects a subskill from another course even with an earlier order", () => {
  const ws = fixture(); ws.problems[0]!.subskillIds = ["foreign.s1"];
  const foreign = { ...cards[0]!, courseId: "other", subskills: [{ id: "foreign.s1", name: "foreign", description: "foreign" }] };
  expect(validateWorksheet(ws, [...cards, foreign]).length).toBeGreaterThan(0);
});
it("allows own-unit names-only subskills on Worksheet 4", () => {
  const ws = fixture(); ws.unitId = cards[3]!.unitId;
  ws.problems = [{ ...ws.problems[0]!, subskillIds: [cards[3]!.subskills[0]!.id], methodIds: [] }];
  expect(validateWorksheet(ws, cards)).toEqual([]);
});
