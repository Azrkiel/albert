import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TeachingCardSchema, type TeachingCard } from "../../src/lib/contracts";
import { validateCard } from "../../src/lib/agent/functions/extract-card";
import type { FileText } from "../../src/lib/agent/functions/read-file";

const fixture = (n: number) => TeachingCardSchema.parse(JSON.parse(readFileSync(`fixtures/cards/calc2-u${n}.json`, "utf8")));
// Deliberately supported transcriptions for the hand-written cards. These are
// validator inputs, not a model recording or evidence of live transcription.
function sources(n: number): FileText[] {
  const text: Record<number, string> = {
    1: String.raw`Lecture 5
Lecture 6
Example 1
Example 2
\int u\,dv = uv - \int v\,du
\frac{dy}{dx}
du = \frac{du}{dx}\,dx
u, chosen by LIATE`,
    2: String.raw`Lecture 7
Lecture 8
Example 1
Example 2
\sin^2 x + \cos^2 x = 1
\cos^2 x = \tfrac{1}{2}(1+\cos 2x),\ \sin^2 x = \tfrac{1}{2}(1-\cos 2x)
\frac{d}{dx}\sin x = \cos x`,
    3: String.raw`Lecture 9
Lecture 10
Example 1
Example 2
\sqrt{a^2-x^2}: x=a\sin\theta;\ \sqrt{a^2+x^2}: x=a\tan\theta;\ \sqrt{x^2-a^2}: x=a\sec\theta
dx = a\cos\theta\,d\theta
\theta, always
\frac{dx}{d\theta}`,
  };
  return fixture(n).sourceFileIds.map(fileId => ({ fileId, text: text[n] ?? "", pages: 3 }));
}

describe("teaching-card validation", () => {
  it.each([1, 2, 3, 4])("accepts hand-written Unit %i with supporting source text", n => {
    expect(validateCard(fixture(n), sources(n))).toEqual([]);
  });
  const broken: [string, (c: TeachingCard) => void][] = [
    ["invented Lecture 12, Example 9", c => { c.workedExamples[0]!.label = "Lecture 12, Example 9"; }],
    ["wrong lecture with real example", c => { c.workedExamples[0]!.label = "Lecture 12, Example 2"; }],
    ["wrong example with real lecture", c => { c.workedExamples[0]!.label = "Lecture 9, Example 9"; }],
    ["one-step method", c => { c.methods[0]!.steps = ["Choose x"]; }],
    ["one short method beside a valid method", c => { c.methods[1]!.steps = ["Only one"]; }],
    ["nine subskills", c => { while (c.subskills.length < 9) c.subskills.push({ ...c.subskills[0]!, id: `extra${c.subskills.length}` }); }],
    ["unknown pitfall subskill", c => { c.pitfalls[0]!.subskillId = "unknown"; }],
    ["page beyond actual PDF", c => { c.workedExamples[0]!.page = 4; }],
    ["page zero", c => { c.workedExamples[0]!.page = 0; }],
    ["invented notation", c => { c.notation[0]!.teacherWrites = "unsupported notation"; }],
    ["empty notation", c => { c.notation = []; }],
    ["no worked examples", c => { c.workedExamples = []; }],
    ["no methods", c => { c.methods = []; }],
    ["missing cited source", c => { c.workedExamples[0]!.fileId = "another-file"; }],
  ];
  it.each(broken)("rejects %s", (_name, change) => {
    const card = fixture(3); change(card);
    expect(validateCard(card, sources(3)).length).toBeGreaterThan(0);
  });
  it("does not borrow labels from a different lecture file", () => {
    const card = fixture(3), input = sources(3);
    input[0]!.text = input[0]!.text.replace("Lecture 9", "Lecture 8");
    expect(validateCard(card, input).join("\n")).toContain("Lecture 9");
  });
  it("rejects upcoming steps, examples, and instructional arrays independently", () => {
    for (const mutate of [
      (c: TeachingCard) => { c.methods[0]!.steps = ["Factor denominator"]; },
      (c: TeachingCard) => { c.workedExamples = fixture(3).workedExamples; },
      (c: TeachingCard) => { c.conventions = ["Do this procedure"]; },
    ]) {
      const card = fixture(4); mutate(card);
      expect(validateCard(card, []).length).toBeGreaterThan(0);
    }
  });
});
it("does not accept a numeric label prefix as the cited lecture or example", () => {
  const card = fixture(3), input = sources(3);
  input[0]!.text = input[0]!.text.replace("Lecture 9", "Lecture 90").replace("Example 2", "Example 20");
  expect(validateCard(card, input).join("\n")).toContain("Unsupported example label");
});
describe("teacherWrites source support ignores only insignificant TeX spacing", () => {
  const withNotation = (cardWrites: string, sourceWrites: string) => {
    const card = fixture(3), input = sources(3);
    card.notation[0]!.teacherWrites = cardWrites;
    input[0]!.text = `${input[0]!.text}\nSo $${sourceWrites}$.`;
    return validateCard(card, input).filter(p => p.startsWith("Unsupported teacherWrites"));
  };
  it("accepts notation that differs from the transcription only by spaces around TeX spacing", () => {
    // Live P6.1 run: the lecture said `dw = -\sin x \, dx`, the model copied `dw = -\sin x\,dx`.
    expect(withNotation(String.raw`dw = -\sin x\,dx`, String.raw`dw = -\sin x \, dx`)).toEqual([]);
    expect(withNotation(String.raw`dw=-\sin x \, dx`, String.raw`dw = -\sin x\,dx`)).toEqual([]);
  });
  it("treats display and text fraction size as the same fraction", () => {
    // Live P6.1 run: the transcription wrote both \frac{du}{dx} and \dfrac{dy}{dx} for Leibniz form.
    expect(withNotation(String.raw`\frac{dy}{dx}`, String.raw`\dfrac{dy}{dx} = e^x`)).toEqual([]);
    expect(withNotation(String.raw`\dfrac{1}{2}`, String.raw`\tfrac{1}{2}`)).toEqual([]);
    expect(withNotation(String.raw`\frac{dy}{dx}`, String.raw`\dfrac{du}{dx}`)).toHaveLength(1);
  });
  it("still rejects notation the source does not contain", () => {
    expect(withNotation(String.raw`dw = \sin x\,dx`, String.raw`dw = -\sin x \, dx`)).toHaveLength(1);
    expect(withNotation(String.raw`dw = -\cos x\,dx`, String.raw`dw = -\sin x \, dx`)).toHaveLength(1);
  });
  it("keeps the space that ends a control word", () => {
    expect(withNotation(String.raw`\sinx`, String.raw`\sin x`)).toHaveLength(1);
    expect(withNotation(String.raw`\sin x`, String.raw`\sinx`)).toHaveLength(1);
  });
});
